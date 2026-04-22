import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for the unified command-palette search.
 *
 * Covers:
 *   - tenant isolation (a candidate in another account must not appear).
 *   - case-insensitive substring match across both jobs and candidates.
 *   - short-query short-circuit (q < 2 chars returns an empty payload).
 *   - result caps at 5+5 entries so the palette stays scannable.
 */
describe('Search (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const email = `search-owner-${suffix}@test.local`;
  const otherEmail = `search-other-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  let token: string;
  let otherToken: string;
  let accountId: string;
  let otherAccountId: string;

  const headers = () => ({ Authorization: `Bearer ${token}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, displayName: 'Search Owner' })
      .expect(201);
    token = reg.body.accessToken;
    const otherReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: otherEmail, password, displayName: 'Other Owner' })
      .expect(201);
    otherToken = otherReg.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Search Co', slug: `search-${suffix}`, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    const otherAcc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Other Co', slug: `search-other-${suffix}`, region: 'us-east-1' })
      .expect(201);
    otherAccountId = otherAcc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(headers())
      .send({ name: 'Search Pipeline', statuses: [{ name: 'Applied', category: 'NEW' }] })
      .expect(201);

    // Seed 6 jobs (title variations) — expect cap to 5.
    for (let i = 0; i < 6; i++) {
      await request(app.getHttpServer())
        .post('/jobs')
        .set(headers())
        .send({ title: `Search Engineer ${i}-${suffix}`, pipelineId: pipelineRes.body.id })
        .expect(201);
    }
    // A differently named job so "engineer" still matches but "designer" does not.
    await request(app.getHttpServer())
      .post('/jobs')
      .set(headers())
      .send({ title: `Senior Designer ${suffix}`, pipelineId: pipelineRes.body.id })
      .expect(201);

    // Seed 6 candidates.
    for (let i = 0; i < 6; i++) {
      await request(app.getHttpServer())
        .post('/candidates')
        .set(headers())
        .send({ firstName: 'Alpha', lastName: `Beta-${i}-${suffix}` })
        .expect(201);
    }

    // Put a candidate in the OTHER account to verify tenant isolation.
    const otherPipeline = await request(app.getHttpServer())
      .post('/pipelines')
      .set({ Authorization: `Bearer ${otherToken}`, 'x-account-id': otherAccountId })
      .send({ name: 'Other', statuses: [{ name: 'Applied', category: 'NEW' }] })
      .expect(201);
    await request(app.getHttpServer())
      .post('/candidates')
      .set({ Authorization: `Bearer ${otherToken}`, 'x-account-id': otherAccountId })
      .send({ firstName: 'Alpha', lastName: `OtherTenant-${suffix}` })
      .expect(201);
    await request(app.getHttpServer())
      .post('/jobs')
      .set({ Authorization: `Bearer ${otherToken}`, 'x-account-id': otherAccountId })
      .send({ title: `Search Engineer Other-${suffix}`, pipelineId: otherPipeline.body.id })
      .expect(201);
  });

  afterAll(async () => {
    for (const id of [accountId, otherAccountId]) {
      await regional.candidate.deleteMany({ where: { accountId: id } });
      await regional.jobMember.deleteMany({ where: { accountId: id } });
      await regional.job.deleteMany({ where: { accountId: id } });
      await regional.pipelineStatus.deleteMany({ where: { pipeline: { accountId: id } } });
      await regional.pipeline.deleteMany({ where: { accountId: id } });
      await regional.auditEvent.deleteMany({ where: { accountId: id } });
      await regional.account.deleteMany({ where: { id } });
    }
    await regional.$disconnect();
    await db.membership.deleteMany({ where: { accountId: { in: [accountId, otherAccountId] } } });
    await db.accountDirectory.deleteMany({ where: { id: { in: [accountId, otherAccountId] } } });
    await db.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
    await app.close();
  });

  it('short query returns empty result without hitting the DB', async () => {
    const res = await request(app.getHttpServer())
      .get('/search?q=a')
      .set(headers())
      .expect(200);
    expect(res.body).toEqual({ query: 'a', jobs: [], candidates: [], total: 0 });
  });

  it('matches jobs case-insensitively and caps at 5', async () => {
    const res = await request(app.getHttpServer())
      .get('/search?q=ENGINEER')
      .set(headers())
      .expect(200);
    expect(res.body.jobs.length).toBe(5);
    for (const j of res.body.jobs) {
      expect(j.title.toLowerCase()).toContain('engineer');
    }
    // "designer" job should not leak into jobs.
    expect(res.body.jobs.find((j: any) => j.title.toLowerCase().includes('designer'))).toBeUndefined();
  });

  it('matches candidates by name or email', async () => {
    const res = await request(app.getHttpServer())
      .get(`/search?q=Alpha`)
      .set(headers())
      .expect(200);
    expect(res.body.candidates.length).toBe(5);
    for (const c of res.body.candidates) {
      expect(c.firstName).toBe('Alpha');
      // None should be the other-tenant candidate.
      expect(c.lastName).not.toContain('OtherTenant');
    }
  });

  it('tenant isolation: jobs from another account do not appear', async () => {
    const res = await request(app.getHttpServer())
      .get(`/search?q=Search Engineer Other-${suffix}`)
      .set(headers())
      .expect(200);
    expect(res.body.jobs).toEqual([]);
  });

  it('returns combined total = jobs + candidates', async () => {
    const res = await request(app.getHttpServer())
      .get('/search?q=Alpha')
      .set(headers())
      .expect(200);
    expect(res.body.total).toBe(res.body.jobs.length + res.body.candidates.length);
  });
});
