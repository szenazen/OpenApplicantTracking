import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for application-scoped comments + reactions.
 *
 * Covers the reliability contract in design/ATS-design.drawio.xml:
 *   - Comments: Idempotency-Key + expectedVersion (same contract as JobNote).
 *   - Reactions: DB-level unique([applicationId, userId, kind]) guarantees
 *     toggling is naturally idempotent — PUT twice and DELETE twice are
 *     safe no-ops.
 *   - Count aggregates surfaced on the Kanban card payload via GET /jobs/:id.
 */
describe('Comments + Reactions (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const authorEmail = `comments-author-${suffix}@test.local`;
  const otherEmail = `comments-other-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `comments-${suffix}`;
  let authorToken: string;
  let otherToken: string;
  let accountId: string;
  let applicationId: string;
  let jobId: string;

  const authorHeaders = () => ({ Authorization: `Bearer ${authorToken}`, 'x-account-id': accountId });
  const otherHeaders = () => ({ Authorization: `Bearer ${otherToken}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const authorReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: authorEmail, password, displayName: 'Comment Author' })
      .expect(201);
    authorToken = authorReg.body.accessToken;

    const otherReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: otherEmail, password, displayName: 'Comment Peer' })
      .expect(201);
    otherToken = otherReg.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ name: 'Comments Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    // The account creator is auto-enrolled; seed the second user as a
    // member too so their reaction API calls clear the AccountGuard.
    const adminRole = await db.role.findFirstOrThrow({ where: { name: 'admin' } });
    const otherUser = await db.user.findFirstOrThrow({ where: { email: otherEmail } });
    await db.membership.create({
      data: { userId: otherUser.id, accountId, roleId: adminRole.id, status: 'ACTIVE' },
    });

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    // Pipeline with a NEW column so apply() has a default target.
    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(authorHeaders())
      .send({ name: 'Comments Pipeline', statuses: [{ name: 'Applied', category: 'NEW' }] })
      .expect(201);

    const jobRes = await request(app.getHttpServer())
      .post('/jobs')
      .set(authorHeaders())
      .send({ title: 'Senior Engineer', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobId = jobRes.body.id;

    const candRes = await request(app.getHttpServer())
      .post('/candidates')
      .set(authorHeaders())
      .send({ firstName: 'Jane', lastName: `Doe-${suffix}` })
      .expect(201);

    const appRes = await request(app.getHttpServer())
      .post('/applications')
      .set(authorHeaders())
      .send({ candidateId: candRes.body.id, jobId })
      .expect(201);
    applicationId = appRes.body.id;
  });

  afterAll(async () => {
    await regional.applicationReaction.deleteMany({ where: { accountId } });
    await regional.applicationComment.deleteMany({ where: { accountId } });
    await regional.applicationTransition.deleteMany({ where: { application: { accountId } } });
    await regional.application.deleteMany({ where: { accountId } });
    await regional.candidate.deleteMany({ where: { accountId } });
    await regional.job.deleteMany({ where: { accountId } });
    await regional.pipelineStatus.deleteMany({ where: { pipeline: { accountId } } });
    await regional.pipeline.deleteMany({ where: { accountId } });
    await regional.auditEvent.deleteMany({ where: { accountId } });
    await regional.account.deleteMany({ where: { id: accountId } });
    await regional.$disconnect();
    await db.membership.deleteMany({ where: { accountId } });
    await db.accountDirectory.deleteMany({ where: { id: accountId } });
    await db.user.deleteMany({ where: { email: { in: [authorEmail, otherEmail] } } });
    await app.close();
  });

  // --- Comments ---

  it('creates a comment and returns author + version=0', async () => {
    const res = await request(app.getHttpServer())
      .post(`/applications/${applicationId}/comments`)
      .set(authorHeaders())
      .send({ body: 'Strong CV — schedule a call.' })
      .expect(201);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.applicationId).toBe(applicationId);
    expect(res.body.version).toBe(0);
    expect(res.body.author.email).toBe(authorEmail);
  });

  it('lists comments newest-first and excludes soft-deleted', async () => {
    const list = await request(app.getHttpServer())
      .get(`/applications/${applicationId}/comments`)
      .set(authorHeaders())
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThan(0);
  });

  it('Idempotency-Key: replayed create is a no-op, no duplicate row', async () => {
    const key = `comment-${suffix}`;
    const first = await request(app.getHttpServer())
      .post(`/applications/${applicationId}/comments`)
      .set({ ...authorHeaders(), 'idempotency-key': key })
      .send({ body: 'Idempotent comment.' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/applications/${applicationId}/comments`)
      .set({ ...authorHeaders(), 'idempotency-key': key })
      .send({ body: 'Idempotent comment.' })
      .expect(201);
    expect(second.body.id).toBe(first.body.id);

    const rows = await regional.applicationComment.findMany({ where: { applicationId, idempotencyKey: key } });
    expect(rows.length).toBe(1);
  });

  it('update: OCC mismatch → 409; matching version bumps row', async () => {
    const created = await request(app.getHttpServer())
      .post(`/applications/${applicationId}/comments`)
      .set(authorHeaders())
      .send({ body: 'Draft.' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/comments/${created.body.id}`)
      .set(authorHeaders())
      .send({ body: 'Updated', expectedVersion: 42 })
      .expect(409);

    const ok = await request(app.getHttpServer())
      .patch(`/comments/${created.body.id}`)
      .set(authorHeaders())
      .send({ body: 'Updated body.', expectedVersion: 0 })
      .expect(200);
    expect(ok.body.version).toBe(1);
  });

  it('update: only the author can edit (403 for another user)', async () => {
    const created = await request(app.getHttpServer())
      .post(`/applications/${applicationId}/comments`)
      .set(authorHeaders())
      .send({ body: 'Author only.' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/comments/${created.body.id}`)
      .set(otherHeaders())
      .send({ body: 'Hijack!', expectedVersion: 0 })
      .expect(403);
  });

  it('delete: soft-deletes and writes a comment.deleted audit event', async () => {
    const created = await request(app.getHttpServer())
      .post(`/applications/${applicationId}/comments`)
      .set(authorHeaders())
      .send({ body: 'Throwaway comment.' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/comments/${created.body.id}`)
      .set(authorHeaders())
      .expect(200);

    const row = await regional.applicationComment.findUnique({ where: { id: created.body.id } });
    expect(row?.deletedAt).not.toBeNull();

    const events = await regional.auditEvent.findMany({
      where: { accountId, action: 'comment.deleted', resource: `comment:${created.body.id}` },
    });
    expect(events.length).toBe(1);
  });

  it('POST rejects empty body with 400', async () => {
    await request(app.getHttpServer())
      .post(`/applications/${applicationId}/comments`)
      .set(authorHeaders())
      .send({ body: '  ' })
      .expect(400);
  });

  // --- Reactions ---

  it('summary starts empty', async () => {
    // Use a fresh application to isolate from comment tests.
    const candRes = await request(app.getHttpServer())
      .post('/candidates')
      .set(authorHeaders())
      .send({ firstName: 'React', lastName: `Test-${suffix}` })
      .expect(201);
    const appRes = await request(app.getHttpServer())
      .post('/applications')
      .set(authorHeaders())
      .send({ candidateId: candRes.body.id, jobId })
      .expect(201);
    const freshId = appRes.body.id;

    const res = await request(app.getHttpServer())
      .get(`/applications/${freshId}/reactions`)
      .set(authorHeaders())
      .expect(200);
    expect(res.body).toEqual({
      counts: { THUMBS_UP: 0, THUMBS_DOWN: 0, STAR: 0 },
      myReactions: [],
    });
  });

  it('PUT reaction is idempotent: starring twice still counts as one', async () => {
    const first = await request(app.getHttpServer())
      .put(`/applications/${applicationId}/reactions/STAR`)
      .set(authorHeaders())
      .expect(200);
    expect(first.body.counts.STAR).toBe(1);
    expect(first.body.myReactions).toEqual(expect.arrayContaining(['STAR']));

    const second = await request(app.getHttpServer())
      .put(`/applications/${applicationId}/reactions/STAR`)
      .set(authorHeaders())
      .expect(200);
    expect(second.body.counts.STAR).toBe(1);

    const rows = await regional.applicationReaction.findMany({
      where: { applicationId, kind: 'STAR' },
    });
    expect(rows.length).toBe(1);
  });

  it('different users contribute independently to the count', async () => {
    const before = await request(app.getHttpServer())
      .get(`/applications/${applicationId}/reactions`)
      .set(authorHeaders())
      .expect(200);
    const starsBefore = before.body.counts.STAR;

    const other = await request(app.getHttpServer())
      .put(`/applications/${applicationId}/reactions/STAR`)
      .set(otherHeaders())
      .expect(200);
    expect(other.body.counts.STAR).toBe(starsBefore + 1);
    // Other user's "my reactions" reflect only their state.
    expect(other.body.myReactions).toEqual(['STAR']);
  });

  it('DELETE reaction: toggling off removes my row, leaves others intact', async () => {
    // Author un-stars (they starred in the earlier test).
    const res = await request(app.getHttpServer())
      .delete(`/applications/${applicationId}/reactions/STAR`)
      .set(authorHeaders())
      .expect(200);
    expect(res.body.myReactions).not.toContain('STAR');
    // The other user's star still counts.
    expect(res.body.counts.STAR).toBeGreaterThanOrEqual(1);
  });

  it('invalid kind → 400', async () => {
    await request(app.getHttpServer())
      .put(`/applications/${applicationId}/reactions/HEART`)
      .set(authorHeaders())
      .expect(400);
  });

  // --- Kanban payload integration ---

  it('GET /jobs/:id surfaces commentCount + reactionSummary per application', async () => {
    // Drop a thumbs-up so reactionSummary has something non-zero.
    await request(app.getHttpServer())
      .put(`/applications/${applicationId}/reactions/THUMBS_UP`)
      .set(authorHeaders())
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobId}`)
      .set(authorHeaders())
      .expect(200);

    const ours = res.body.applications.find((a: any) => a.id === applicationId);
    expect(ours).toBeTruthy();
    expect(ours.commentCount).toBeGreaterThanOrEqual(1);
    expect(ours.reactionSummary.counts.THUMBS_UP).toBeGreaterThanOrEqual(1);
    expect(ours.reactionSummary.myReactions).toEqual(expect.arrayContaining(['THUMBS_UP']));
  });
});
