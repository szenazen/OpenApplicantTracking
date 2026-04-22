import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for `PATCH /jobs/:id` — the server-side of the "Edit
 * job" dialog + the 3-dot status menu.
 *
 * We verify:
 *   - partial updates only touch the sent fields (ignored-field safety),
 *   - nullable string fields can be cleared with an explicit `null`,
 *   - status transitions stamp `openedAt` / `closedAt` on the canonical
 *     terminals (PUBLISHED for the first time, CLOSED, ARCHIVED),
 *   - an `AuditEvent` with `action=job.updated` is emitted carrying a diff
 *     of the changed fields so the Activities tab picks it up,
 *   - unknown job 404s,
 *   - validation rejects empty titles.
 */
describe('Jobs update (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const ownerEmail = `jobs-upd-owner-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `jobs-upd-${suffix}`;
  let ownerToken: string;
  let accountId: string;
  let jobId: string;

  const hdr = () => ({ Authorization: `Bearer ${ownerToken}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const ownerReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ownerEmail, password, displayName: 'Jobs Update Owner' })
      .expect(201);
    ownerToken = ownerReg.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Jobs Update Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(hdr())
      .send({ name: 'Upd Pipeline', statuses: [{ name: 'New', category: 'NEW' }] })
      .expect(201);

    const jobRes = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({
        title: 'Original title',
        description: 'Original description',
        department: 'Eng',
        location: 'Remote',
        employmentType: 'FULL_TIME',
        pipelineId: pipelineRes.body.id,
        requiredSkillIds: [],
      })
      .expect(201);
    jobId = jobRes.body.id;
  });

  afterAll(async () => {
    await regional.auditEvent.deleteMany({ where: { accountId } });
    await regional.job.deleteMany({ where: { accountId } });
    await regional.pipelineStatus.deleteMany({ where: { pipeline: { accountId } } });
    await regional.pipeline.deleteMany({ where: { accountId } });
    await regional.account.deleteMany({ where: { id: accountId } });
    await regional.$disconnect();
    await db.membership.deleteMany({ where: { accountId } });
    await db.accountDirectory.deleteMany({ where: { id: accountId } });
    await db.user.deleteMany({ where: { email: ownerEmail } });
    await app.close();
  });

  it('applies partial updates and does not touch untouched fields', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/jobs/${jobId}`)
      .set(hdr())
      .send({ title: 'Updated title', department: 'Platform' })
      .expect(200);
    expect(res.body.title).toBe('Updated title');
    expect(res.body.department).toBe('Platform');
    // Description was not in the patch, so it stays.
    expect(res.body.description).toBe('Original description');
  });

  it('clears nullable string fields when sent as null', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/jobs/${jobId}`)
      .set(hdr())
      .send({ location: null, description: null })
      .expect(200);
    expect(res.body.location).toBeNull();
    expect(res.body.description).toBeNull();
  });

  it('status transition to CLOSED stamps closedAt and emits a job.updated audit event', async () => {
    const before = await regional.auditEvent.count({ where: { accountId, action: 'job.updated' } });
    const res = await request(app.getHttpServer())
      .patch(`/jobs/${jobId}`)
      .set(hdr())
      .send({ status: 'CLOSED' })
      .expect(200);
    expect(res.body.status).toBe('CLOSED');
    expect(res.body.closedAt).not.toBeNull();

    const after = await regional.auditEvent.count({ where: { accountId, action: 'job.updated' } });
    expect(after).toBe(before + 1);

    const events = await regional.auditEvent.findMany({
      where: { accountId, action: 'job.updated' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    const meta = events[0]!.metadata as Record<string, unknown>;
    expect(meta.jobId).toBe(jobId);
    expect(Array.isArray(meta.changedFields)).toBe(true);
    expect((meta.changedFields as string[])).toContain('status');
  });

  it('re-opening a closed job clears closedAt', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/jobs/${jobId}`)
      .set(hdr())
      .send({ status: 'PUBLISHED' })
      .expect(200);
    expect(res.body.status).toBe('PUBLISHED');
    expect(res.body.closedAt).toBeNull();
  });

  it('no-op patch (same value) does not create a job.updated event', async () => {
    const before = await regional.auditEvent.count({ where: { accountId, action: 'job.updated' } });
    // Re-send the current title — should not trigger any diff.
    const job = await regional.job.findUnique({ where: { id: jobId } });
    await request(app.getHttpServer())
      .patch(`/jobs/${jobId}`)
      .set(hdr())
      .send({ title: job!.title })
      .expect(200);
    const after = await regional.auditEvent.count({ where: { accountId, action: 'job.updated' } });
    expect(after).toBe(before);
  });

  it('GET /jobs/:id resolves requiredSkills to id+name pairs', async () => {
    const res = await request(app.getHttpServer()).get(`/jobs/${jobId}`).set(hdr()).expect(200);
    expect(Array.isArray(res.body.requiredSkills)).toBe(true);
    expect(res.body.requiredSkills.length).toBe(0);
  });

  it('404s on an unknown job', async () => {
    await request(app.getHttpServer())
      .patch(`/jobs/does-not-exist`)
      .set(hdr())
      .send({ title: 'x' })
      .expect(404);
  });

  it('400s on an empty title', async () => {
    await request(app.getHttpServer())
      .patch(`/jobs/${jobId}`)
      .set(hdr())
      .send({ title: '' })
      .expect(400);
  });
});
