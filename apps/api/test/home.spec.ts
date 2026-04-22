import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for `GET /home` — the recruiter landing-page summary.
 *
 * We seed an isolated account with a tiny pipeline + 2 jobs + a handful of
 * applications + transitions, then assert each surface block of the home
 * payload is shaped right and respects the right window for "this week"
 * counts and the staleness threshold for the attention list.
 */
describe('Home summary (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const ownerEmail = `home-owner-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `home-${suffix}`;
  let ownerToken: string;
  let ownerUserId: string;
  let accountId: string;
  let pipelineId: string;
  let newStatusId: string;
  let inProgressStatusId: string;
  let hiredStatusId: string;
  let droppedStatusId: string;
  let jobAId: string;
  let jobBId: string;

  const hdr = () => ({ Authorization: `Bearer ${ownerToken}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const ownerReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ownerEmail, password, displayName: 'Home Owner' })
      .expect(201);
    ownerToken = ownerReg.body.accessToken;
    const owner = await db.user.findUnique({ where: { email: ownerEmail } });
    ownerUserId = owner!.id;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Home Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    const pipeRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(hdr())
      .send({
        name: 'Home Pipeline',
        statuses: [
          { name: 'New', category: 'NEW' },
          { name: 'Screen', category: 'IN_PROGRESS' },
          { name: 'Hired', category: 'HIRED' },
          { name: 'Dropped', category: 'DROPPED' },
        ],
      })
      .expect(201);
    pipelineId = pipeRes.body.id;
    const statuses = await regional.pipelineStatus.findMany({ where: { pipelineId } });
    newStatusId = statuses.find((s) => s.category === 'NEW')!.id;
    inProgressStatusId = statuses.find((s) => s.category === 'IN_PROGRESS')!.id;
    hiredStatusId = statuses.find((s) => s.category === 'HIRED')!.id;
    droppedStatusId = statuses.find((s) => s.category === 'DROPPED')!.id;

    // POST /jobs defaults to PUBLISHED. Create A and B both PUBLISHED, then
    // PATCH B's status to ON_HOLD so the byStatus tile has a non-PUBLISHED
    // bucket to assert against AND we get a `job.updated` audit event for
    // the recent-activity assertion (a no-op patch wouldn't emit anything).
    const jobA = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({ title: 'Job A', pipelineId, employmentType: 'FULL_TIME' })
      .expect(201);
    jobAId = jobA.body.id;

    const jobB = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({ title: 'Job B', pipelineId, employmentType: 'FULL_TIME' })
      .expect(201);
    jobBId = jobB.body.id;
    await request(app.getHttpServer())
      .patch(`/jobs/${jobBId}`)
      .set(hdr())
      .send({ status: 'ON_HOLD' })
      .expect(200);

    // Candidates + applications.
    const candA = await regional.candidate.create({
      data: { accountId, firstName: 'Stale', lastName: 'Sam' },
    });
    const candB = await regional.candidate.create({
      data: { accountId, firstName: 'Fresh', lastName: 'Fran' },
    });
    const candHire = await regional.candidate.create({
      data: { accountId, firstName: 'Hired', lastName: 'Hannah' },
    });
    const candDrop = await regional.candidate.create({
      data: { accountId, firstName: 'Dropped', lastName: 'Dan' },
    });

    // 1) A stale in-progress application on Job A (lastTransitionAt > 7d ago).
    const stale = new Date(Date.now() - 14 * 86_400_000);
    const staleApp = await regional.application.create({
      data: {
        accountId,
        jobId: jobAId,
        candidateId: candA.id,
        currentStatusId: inProgressStatusId,
        position: 0,
        appliedAt: stale,
        lastTransitionAt: stale,
      },
    });
    await regional.applicationTransition.create({
      data: {
        applicationId: staleApp.id,
        fromStatusId: null,
        toStatusId: inProgressStatusId,
        byUserId: ownerUserId,
        createdAt: stale,
      },
    });

    // 2) A fresh in-progress application on Job A.
    await regional.application.create({
      data: {
        accountId,
        jobId: jobAId,
        candidateId: candB.id,
        currentStatusId: newStatusId,
        position: 1,
      },
    });

    // 3) A recent hire (within window) on Job A.
    const hireApp = await regional.application.create({
      data: {
        accountId,
        jobId: jobAId,
        candidateId: candHire.id,
        currentStatusId: hiredStatusId,
        position: 0,
      },
    });
    await regional.applicationTransition.create({
      data: {
        applicationId: hireApp.id,
        fromStatusId: inProgressStatusId,
        toStatusId: hiredStatusId,
        byUserId: ownerUserId,
      },
    });

    // 4) A recent drop on Job B.
    const dropApp = await regional.application.create({
      data: {
        accountId,
        jobId: jobBId,
        candidateId: candDrop.id,
        currentStatusId: droppedStatusId,
        position: 0,
      },
    });
    await regional.applicationTransition.create({
      data: {
        applicationId: dropApp.id,
        fromStatusId: inProgressStatusId,
        toStatusId: droppedStatusId,
        byUserId: ownerUserId,
        reason: 'Compensation mismatch',
      },
    });

    // Add the owner as a JobMember on Job A so myJobs picks it up.
    await regional.jobMember.create({
      data: {
        accountId,
        jobId: jobAId,
        userId: ownerUserId,
        role: 'OWNER',
      },
    });
  });

  afterAll(async () => {
    await regional.applicationTransition.deleteMany({ where: { application: { accountId } } });
    await regional.application.deleteMany({ where: { accountId } });
    await regional.candidate.deleteMany({ where: { accountId } });
    await regional.jobMember.deleteMany({ where: { accountId } });
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

  it('returns top-level structure with the configured windows', async () => {
    const res = await request(app.getHttpServer()).get('/home').set(hdr()).expect(200);
    expect(res.body.window.recentDays).toBeGreaterThan(0);
    expect(res.body.window.stuckThresholdDays).toBeGreaterThan(0);
    expect(res.body.jobs.total).toBe(2);
    expect(res.body.jobs.byStatus.PUBLISHED).toBe(1);
    expect(res.body.jobs.byStatus.ON_HOLD).toBe(1);
  });

  it('counts pipeline buckets by current status category', async () => {
    const res = await request(app.getHttpServer()).get('/home').set(hdr()).expect(200);
    // 2 in-progress (stale + fresh), 1 hired, 1 dropped → 4 apps total.
    expect(res.body.pipeline.applications).toBe(4);
    expect(res.body.pipeline.inPipeline).toBe(2);
    expect(res.body.pipeline.hiredCurrent).toBe(1);
    expect(res.body.pipeline.droppedCurrent).toBe(1);
  });

  it('counts hires and drops in the recent window from real transitions', async () => {
    const res = await request(app.getHttpServer()).get('/home').set(hdr()).expect(200);
    // Both terminal transitions were created just now → both inside the window.
    expect(res.body.pipeline.hiresInWindow).toBeGreaterThanOrEqual(1);
    expect(res.body.pipeline.dropsInWindow).toBeGreaterThanOrEqual(1);
  });

  it('flags Job A as needing attention because of the stale application', async () => {
    const res = await request(app.getHttpServer()).get('/home').set(hdr()).expect(200);
    const ids = res.body.attention.map((j: any) => j.id);
    expect(ids).toContain(jobAId);
    const a = res.body.attention.find((j: any) => j.id === jobAId);
    expect(a.stuckCount).toBeGreaterThanOrEqual(1);
  });

  it('lists the requester’s assigned jobs', async () => {
    const res = await request(app.getHttpServer()).get('/home').set(hdr()).expect(200);
    const ids = res.body.myJobs.map((j: any) => j.id);
    expect(ids).toContain(jobAId);
    const a = res.body.myJobs.find((j: any) => j.id === jobAId);
    expect(a.role).toBe('OWNER');
  });

  it('returns recent activity scoped to the account', async () => {
    const res = await request(app.getHttpServer()).get('/home').set(hdr()).expect(200);
    expect(Array.isArray(res.body.recentActivity)).toBe(true);
    // Job creation + the PATCH PUBLISHED were emitted as audit events.
    expect(res.body.recentActivity.length).toBeGreaterThan(0);
  });

  it('returns a performance summary for the requester', async () => {
    const res = await request(app.getHttpServer()).get('/home').set(hdr()).expect(200);
    expect(res.body.window.performanceDays).toBeGreaterThan(0);
    expect(res.body.performance).toBeDefined();
    expect(res.body.performance.windowDays).toBe(res.body.window.performanceDays);
    // Owner is a member of Job A which has two in-progress apps (stale + fresh).
    expect(res.body.performance.owned).toBe(2);
    // Seeded transitions attributed to the owner.
    expect(res.body.performance.placed).toBeGreaterThanOrEqual(1);
    expect(res.body.performance.dropped).toBeGreaterThanOrEqual(1);
    // No candidate.imported / application.created audits in the seed path.
    expect(res.body.performance.created).toBe(0);
    expect(res.body.performance.addedToJob).toBe(0);
  });

  it('returns recent-touched structure (empty is fine for this seed)', async () => {
    const res = await request(app.getHttpServer()).get('/home').set(hdr()).expect(200);
    expect(res.body.recentTouched).toBeDefined();
    expect(Array.isArray(res.body.recentTouched.candidates)).toBe(true);
    expect(Array.isArray(res.body.recentTouched.jobs)).toBe(true);
    // The owner did a PATCH on Job B (`job.updated`) — that should surface.
    const ids = res.body.recentTouched.jobs.map((j: any) => j.id);
    expect(ids).toContain(jobBId);
  });

  it('rejects requests without an account context', async () => {
    await request(app.getHttpServer())
      .get('/home')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(403);
  });
});
