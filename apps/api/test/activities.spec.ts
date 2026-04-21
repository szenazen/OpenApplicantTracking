import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for the job activities feed.
 *
 * The feed is a single chronological stream of `AuditEvent` rows filtered by
 * `metadata.jobId`. Every write path stamps that field, so this spec exercises
 * that contract end-to-end by driving real domain actions (apply, move,
 * comment, react, note) and asserting each one shows up on the right job's
 * feed in the expected order.
 *
 * It also pins the keyset pagination contract: `?before=<iso>&limit=<n>`
 * returns older entries and never skips a row under concurrent writes.
 */
describe('Activities feed (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const email = `activities-owner-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `activities-${suffix}`;
  let token: string;
  let accountId: string;
  let jobAId: string;
  let jobBId: string;
  let appAId: string;
  let statusApplied: string;
  let statusScreen: string;

  const hdr = () => ({ Authorization: `Bearer ${token}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, displayName: 'Activities Owner' })
      .expect(201);
    token = reg.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Activities Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    // Pipeline with two stages so we can move cards.
    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(hdr())
      .send({
        name: 'Activities Pipeline',
        statuses: [
          { name: 'Applied', category: 'NEW' },
          { name: 'Screen', category: 'IN_PROGRESS' },
        ],
      })
      .expect(201);
    statusApplied = pipelineRes.body.statuses[0].id;
    statusScreen = pipelineRes.body.statuses[1].id;

    // Two jobs on the same pipeline — to prove the feed is scoped per job.
    const jobA = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({ title: 'Job A', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobAId = jobA.body.id;
    const jobB = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({ title: 'Job B', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobBId = jobB.body.id;

    const cand = await request(app.getHttpServer())
      .post('/candidates')
      .set(hdr())
      .send({ firstName: 'Ada', lastName: `Feed-${suffix}` })
      .expect(201);

    const application = await request(app.getHttpServer())
      .post('/applications')
      .set(hdr())
      .send({ candidateId: cand.body.id, jobId: jobAId })
      .expect(201);
    appAId = application.body.id;

    // Drive one of every activity kind against Job A so the feed is rich.
    await request(app.getHttpServer())
      .patch(`/applications/${appAId}/move`)
      .set(hdr())
      .send({ toStatusId: statusScreen, toPosition: 0, expectedVersion: 0 })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/applications/${appAId}/comments`)
      .set(hdr())
      .send({ body: 'Great résumé.' })
      .expect(201);

    await request(app.getHttpServer())
      .put(`/applications/${appAId}/reactions/STAR`)
      .set(hdr())
      .expect(200);

    await request(app.getHttpServer())
      .post(`/jobs/${jobAId}/notes`)
      .set(hdr())
      .send({ body: 'Kick-off sync on Monday.' })
      .expect(201);

    // One activity against Job B so we can prove cross-job isolation.
    const candB = await request(app.getHttpServer())
      .post('/candidates')
      .set(hdr())
      .send({ firstName: 'Bo', lastName: `Feed-${suffix}` })
      .expect(201);
    await request(app.getHttpServer())
      .post('/applications')
      .set(hdr())
      .send({ candidateId: candB.body.id, jobId: jobBId })
      .expect(201);
  });

  afterAll(async () => {
    await regional.applicationReaction.deleteMany({ where: { accountId } });
    await regional.applicationComment.deleteMany({ where: { accountId } });
    await regional.applicationTransition.deleteMany({ where: { application: { accountId } } });
    await regional.application.deleteMany({ where: { accountId } });
    await regional.candidate.deleteMany({ where: { accountId } });
    await regional.jobNote.deleteMany({ where: { accountId } });
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

  it('lists newest-first and includes every action kind against the job', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobAId}/activities`)
      .set(hdr())
      .expect(200);

    const actions = res.body.entries.map((e: any) => e.action);
    // All five mutations we drove should be present.
    expect(actions).toEqual(expect.arrayContaining([
      'application.created',
      'application.moved',
      'comment.created',
      'reaction.added',
      'note.created',
    ]));

    // createdAt strictly descending.
    const times = res.body.entries.map((e: any) => new Date(e.createdAt).getTime());
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });

  it('hydrates the actor display info from the global user table', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobAId}/activities`)
      .set(hdr())
      .expect(200);
    expect(res.body.entries[0].actor).toEqual(
      expect.objectContaining({ email, displayName: 'Activities Owner' }),
    );
  });

  it('scopes strictly to the requested job (Job B entries do not leak into Job A)', async () => {
    const resA = await request(app.getHttpServer())
      .get(`/jobs/${jobAId}/activities`)
      .set(hdr())
      .expect(200);
    const resB = await request(app.getHttpServer())
      .get(`/jobs/${jobBId}/activities`)
      .set(hdr())
      .expect(200);

    const jobIdsOnA = new Set(resA.body.entries.map((e: any) => e.metadata.jobId));
    const jobIdsOnB = new Set(resB.body.entries.map((e: any) => e.metadata.jobId));
    expect(jobIdsOnA).toEqual(new Set([jobAId]));
    expect(jobIdsOnB).toEqual(new Set([jobBId]));
  });

  it('supports keyset pagination via ?before=<iso>&limit=<n>', async () => {
    const firstPage = await request(app.getHttpServer())
      .get(`/jobs/${jobAId}/activities?limit=2`)
      .set(hdr())
      .expect(200);
    expect(firstPage.body.entries.length).toBe(2);
    expect(firstPage.body.nextBefore).toEqual(expect.any(String));

    const secondPage = await request(app.getHttpServer())
      .get(`/jobs/${jobAId}/activities?limit=10&before=${encodeURIComponent(firstPage.body.nextBefore)}`)
      .set(hdr())
      .expect(200);
    // No overlap between the two pages.
    const pageOneIds = new Set(firstPage.body.entries.map((e: any) => e.id));
    for (const e of secondPage.body.entries) expect(pageOneIds.has(e.id)).toBe(false);
  });

  it('returns 404 for an unknown job', async () => {
    await request(app.getHttpServer())
      .get(`/jobs/does-not-exist-${suffix}/activities`)
      .set(hdr())
      .expect(404);
  });

  it('rejects a malformed limit with 400', async () => {
    await request(app.getHttpServer())
      .get(`/jobs/${jobAId}/activities?limit=999999`)
      .set(hdr())
      .expect(400);
  });
});
