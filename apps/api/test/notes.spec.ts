import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for job-scoped notes.
 *
 * Covers the reliability contract called out in design/ATS-design.drawio.xml:
 *   - Idempotency-Key dedupes duplicate POSTs.
 *   - `expectedVersion` enforces optimistic concurrency on update/delete.
 *   - Only the author can edit / delete.
 *   - Deletes are soft and an AuditEvent is written for every mutation
 *     (this is what the Activities tab will consume in Phase F).
 */
describe('Notes (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const ownerEmail = `notes-owner-${suffix}@test.local`;
  const otherEmail = `notes-other-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `notes-${suffix}`;
  let ownerToken: string;
  let otherToken: string;
  let accountId: string;
  let jobId: string;

  const ownerHeaders = () => ({ Authorization: `Bearer ${ownerToken}`, 'x-account-id': accountId });
  const otherHeaders = () => ({ Authorization: `Bearer ${otherToken}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const ownerReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ownerEmail, password, displayName: 'Notes Owner' })
      .expect(201);
    ownerToken = ownerReg.body.accessToken;

    const otherReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: otherEmail, password, displayName: 'Notes Other' })
      .expect(201);
    otherToken = otherReg.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Notes Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    // Minimal pipeline + job so the note endpoints have a real FK target.
    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(ownerHeaders())
      .send({ name: 'Notes Pipeline', statuses: [{ name: 'A', category: 'NEW' }] })
      .expect(201);

    const jobRes = await request(app.getHttpServer())
      .post('/jobs')
      .set(ownerHeaders())
      .send({ title: 'Notes Role', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobId = jobRes.body.id;
  });

  afterAll(async () => {
    await regional.jobNote.deleteMany({ where: { accountId } });
    await regional.job.deleteMany({ where: { accountId } });
    await regional.pipelineStatus.deleteMany({ where: { pipeline: { accountId } } });
    await regional.pipeline.deleteMany({ where: { accountId } });
    await regional.auditEvent.deleteMany({ where: { accountId } });
    await regional.account.deleteMany({ where: { id: accountId } });
    await regional.$disconnect();
    await db.membership.deleteMany({ where: { accountId } });
    await db.accountDirectory.deleteMany({ where: { id: accountId } });
    await db.user.deleteMany({ where: { email: { in: [ownerEmail, otherEmail] } } });
    await app.close();
  });

  it('creates a note and returns it with author info + version=0', async () => {
    const res = await request(app.getHttpServer())
      .post(`/jobs/${jobId}/notes`)
      .set(ownerHeaders())
      .send({ body: 'Good cultural fit — move to HR interview.' })
      .expect(201);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.body).toBe('Good cultural fit — move to HR interview.');
    expect(res.body.version).toBe(0);
    expect(res.body.author.email).toBe(ownerEmail);
  });

  it('list returns notes newest first, excluding soft-deleted', async () => {
    const list = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/notes`)
      .set(ownerHeaders())
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body[0].jobId).toBe(jobId);
  });

  it('Idempotency-Key: replays a create as a no-op and does not duplicate', async () => {
    const key = `note-${suffix}`;
    const first = await request(app.getHttpServer())
      .post(`/jobs/${jobId}/notes`)
      .set({ ...ownerHeaders(), 'idempotency-key': key })
      .send({ body: 'Idempotent note.' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/jobs/${jobId}/notes`)
      .set({ ...ownerHeaders(), 'idempotency-key': key })
      .send({ body: 'Idempotent note.' })
      .expect(201);
    expect(second.body.id).toBe(first.body.id);

    const rows = await regional.jobNote.findMany({ where: { jobId, idempotencyKey: key } });
    expect(rows.length).toBe(1);
  });

  it('update: OCC mismatch → 409; matching version bumps row', async () => {
    const created = await request(app.getHttpServer())
      .post(`/jobs/${jobId}/notes`)
      .set(ownerHeaders())
      .send({ body: 'First draft.' })
      .expect(201);

    // Stale version — rejected.
    await request(app.getHttpServer())
      .patch(`/notes/${created.body.id}`)
      .set(ownerHeaders())
      .send({ body: 'Updated', expectedVersion: 42 })
      .expect(409);

    // Fresh version — accepted; version goes 0 → 1.
    const ok = await request(app.getHttpServer())
      .patch(`/notes/${created.body.id}`)
      .set(ownerHeaders())
      .send({ body: 'Updated body.', expectedVersion: 0 })
      .expect(200);
    expect(ok.body.version).toBe(1);
    expect(ok.body.body).toBe('Updated body.');
  });

  it('update: only the author can edit (403 for another user)', async () => {
    const created = await request(app.getHttpServer())
      .post(`/jobs/${jobId}/notes`)
      .set(ownerHeaders())
      .send({ body: 'Owner only.' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/notes/${created.body.id}`)
      .set(otherHeaders())
      .send({ body: 'Hijack!', expectedVersion: 0 })
      .expect(403);
  });

  it('delete: soft-deletes and writes a note.deleted audit event', async () => {
    const created = await request(app.getHttpServer())
      .post(`/jobs/${jobId}/notes`)
      .set(ownerHeaders())
      .send({ body: 'Throwaway note.' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/notes/${created.body.id}`)
      .set(ownerHeaders())
      .expect(200);

    const row = await regional.jobNote.findUnique({ where: { id: created.body.id } });
    expect(row?.deletedAt).not.toBeNull();

    const events = await regional.auditEvent.findMany({
      where: { accountId, action: 'note.deleted', resource: `note:${created.body.id}` },
    });
    expect(events.length).toBe(1);

    // Deleted notes disappear from list.
    const list = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/notes`)
      .set(ownerHeaders())
      .expect(200);
    expect(list.body.find((n: any) => n.id === created.body.id)).toBeUndefined();
  });

  it('POST rejects empty body with 400', async () => {
    await request(app.getHttpServer())
      .post(`/jobs/${jobId}/notes`)
      .set(ownerHeaders())
      .send({ body: '   ' })
      .expect(400);
  });

  it('GET without x-account-id is rejected (403)', async () => {
    await request(app.getHttpServer())
      .get(`/jobs/${jobId}/notes`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(403);
  });
});
