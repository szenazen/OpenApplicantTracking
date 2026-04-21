import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for Phase K — job-scoped Reports.
 *
 * Seed shape: a 4-stage pipeline (Applied / Screen / Offer / Hired), three
 * applications, with specific transitions so every report slice is
 * exercised:
 *   - Funnel: counts reflect the final status of each application.
 *   - Time-in-stage: "Applied" dwell is asserted > 0 for apps that moved.
 *   - Hires over time: exactly one hire transition lands in today's bucket.
 */
describe('Reports (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const email = `report-owner-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `report-${suffix}`;

  let token: string;
  let accountId: string;
  let jobId: string;
  let appliedId: string;
  let screenId: string;
  let offerId: string;
  let hiredId: string;

  const hdr = () => ({ Authorization: `Bearer ${token}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, displayName: 'Report Owner' })
      .expect(201);
    token = reg.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Report Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(hdr())
      .send({
        name: 'Report Pipeline',
        statuses: [
          { name: 'Applied', category: 'NEW' },
          { name: 'Screen', category: 'IN_PROGRESS' },
          { name: 'Offer', category: 'IN_PROGRESS' },
          { name: 'Hired', category: 'HIRED' },
        ],
      })
      .expect(201);

    const job = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({ title: 'Report Job', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobId = job.body.id;

    // Resolve status ids so we can drive transitions deterministically.
    const statuses = await regional.pipelineStatus.findMany({
      where: { pipelineId: pipelineRes.body.id },
      orderBy: { position: 'asc' },
    });
    [appliedId, screenId, offerId, hiredId] = statuses.map((s) => s.id);

    // Three applications, all start in Applied.
    const c1 = await request(app.getHttpServer()).post('/candidates').set(hdr())
      .send({ firstName: 'Ada', lastName: `R-${suffix}` }).expect(201);
    const c2 = await request(app.getHttpServer()).post('/candidates').set(hdr())
      .send({ firstName: 'Ben', lastName: `R-${suffix}` }).expect(201);
    const c3 = await request(app.getHttpServer()).post('/candidates').set(hdr())
      .send({ firstName: 'Cara', lastName: `R-${suffix}` }).expect(201);

    const a1 = await request(app.getHttpServer()).post('/applications').set(hdr())
      .send({ candidateId: c1.body.id, jobId }).expect(201);
    const a2 = await request(app.getHttpServer()).post('/applications').set(hdr())
      .send({ candidateId: c2.body.id, jobId }).expect(201);
    await request(app.getHttpServer()).post('/applications').set(hdr())
      .send({ candidateId: c3.body.id, jobId }).expect(201);

    // Move a1 all the way to Hired (so we get a hires-over-time data point
    // and dwell samples on Applied/Screen/Offer). Small sleeps guarantee
    // non-zero dwell intervals.
    await sleep(30);
    await request(app.getHttpServer()).patch(`/applications/${a1.body.id}/move`)
      .set(hdr()).send({ toStatusId: screenId, toPosition: 0 }).expect(200);
    await sleep(30);
    await request(app.getHttpServer()).patch(`/applications/${a1.body.id}/move`)
      .set(hdr()).send({ toStatusId: offerId, toPosition: 0 }).expect(200);
    await sleep(30);
    await request(app.getHttpServer()).patch(`/applications/${a1.body.id}/move`)
      .set(hdr()).send({ toStatusId: hiredId, toPosition: 0 }).expect(200);

    // Move a2 to Screen (one dwell sample on Applied).
    await sleep(30);
    await request(app.getHttpServer()).patch(`/applications/${a2.body.id}/move`)
      .set(hdr()).send({ toStatusId: screenId, toPosition: 0 }).expect(200);

    // a3 stays in Applied.
  });

  afterAll(async () => {
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
    await db.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('returns a funnel with correct snapshot counts', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/reports`)
      .set(hdr())
      .expect(200);

    const byName = new Map<string, number>(res.body.funnel.map((f: any) => [f.name, f.count]));
    expect(byName.get('Applied')).toBe(1);
    expect(byName.get('Screen')).toBe(1);
    expect(byName.get('Offer')).toBe(0);
    expect(byName.get('Hired')).toBe(1);
    expect(res.body.totals).toEqual({ applications: 3, hired: 1, dropped: 0, inProgress: 2 });
  });

  it('computes a time-in-stage average for stages that had moves out', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/reports`)
      .set(hdr())
      .expect(200);
    const byName = new Map<string, any>(res.body.timeInStage.map((t: any) => [t.name, t]));
    // Applied had two move-outs (a1 -> screen and a2 -> screen).
    expect(byName.get('Applied').sampleSize).toBe(2);
    expect(byName.get('Applied').avgSeconds).toBeGreaterThan(0);
    // Hired is terminal — no one left, so it stays null.
    expect(byName.get('Hired').avgSeconds).toBeNull();
    expect(byName.get('Hired').sampleSize).toBe(0);
  });

  it('surfaces a hire event today in the hires-over-time series', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/reports?days=7`)
      .set(hdr())
      .expect(200);
    expect(res.body.hiresOverTime.windowDays).toBe(7);
    const today = new Date().toISOString().slice(0, 10);
    const todayBucket = res.body.hiresOverTime.series.find((e: any) => e.date === today);
    expect(todayBucket).toBeDefined();
    expect(todayBucket.count).toBeGreaterThanOrEqual(1);
  });

  it('404s on an unknown job id', async () => {
    await request(app.getHttpServer())
      .get(`/jobs/does-not-exist/reports`)
      .set(hdr())
      .expect(404);
  });
});

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
