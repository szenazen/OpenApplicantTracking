import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for Phase I — the External Sourcing Service.
 *
 * The service currently ships with a LinkedIn-like stub provider + curated
 * fixture so these tests are hermetic and deterministic.
 *
 * We exercise:
 *   - search by keyword (hits across name / company / skills),
 *   - import creates a Candidate + CandidateImport row,
 *   - re-importing the same externalId is idempotent (no duplicate rows),
 *   - importing with a jobId also creates an Application on the first stage
 *     of the job's pipeline,
 *   - the Activities feed surfaces a `candidate.imported` entry stamped
 *     with jobId when relevant.
 */
describe('Sourcing (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const email = `sourcing-owner-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `sourcing-${suffix}`;

  let token: string;
  let accountId: string;
  let jobId: string;

  const hdr = () => ({ Authorization: `Bearer ${token}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, displayName: 'Sourcing Owner' })
      .expect(201);
    token = reg.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sourcing Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(hdr())
      .send({
        name: 'Sourcing Pipeline',
        statuses: [
          { name: 'Applied', category: 'NEW' },
          { name: 'Screen', category: 'IN_PROGRESS' },
        ],
      })
      .expect(201);

    const job = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({ title: 'Sourcing Job', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobId = job.body.id;
  });

  afterAll(async () => {
    await regional.candidateImport.deleteMany({ where: { accountId } });
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

  it('searches the stub provider by keyword across multiple fields', async () => {
    const byCompany = await request(app.getHttpServer())
      .get('/sourcing/search?q=monzo')
      .set(hdr())
      .expect(200);
    expect(byCompany.body.source).toBe('linkedin-stub');
    expect(byCompany.body.results.length).toBeGreaterThan(0);
    expect(byCompany.body.results[0].lastName).toBe('Ward');

    const bySkill = await request(app.getHttpServer())
      .get('/sourcing/search?q=kubernetes')
      .set(hdr())
      .expect(200);
    expect(bySkill.body.results.some((r: any) => r.firstName === 'Adelia')).toBe(true);
  });

  it('imports a candidate — creates Candidate + CandidateImport with the raw payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/sourcing/import')
      .set(hdr())
      .send({ source: 'linkedin-stub', externalId: 'li-marcus-klein' })
      .expect(201);
    expect(res.body.deduped).toBe(false);
    expect(res.body.candidate.firstName).toBe('Marcus');
    expect(res.body.import.status).toBe('COMPLETED');
    expect(res.body.import.source).toBe('linkedin-stub');
  });

  it('is idempotent: re-importing the same externalId returns the original candidate', async () => {
    const second = await request(app.getHttpServer())
      .post('/sourcing/import')
      .set(hdr())
      .send({ source: 'linkedin-stub', externalId: 'li-marcus-klein' })
      .expect(201);
    expect(second.body.deduped).toBe(true);
    const rows = await regional.candidateImport.findMany({
      where: { accountId, source: 'linkedin-stub', externalId: 'li-marcus-klein' },
    });
    expect(rows).toHaveLength(1);
  });

  it('with a jobId, also creates an Application on the first pipeline stage', async () => {
    const res = await request(app.getHttpServer())
      .post('/sourcing/import')
      .set(hdr())
      .send({ source: 'linkedin-stub', externalId: 'li-adelia-ng', jobId })
      .expect(201);
    expect(res.body.candidate.firstName).toBe('Adelia');
    const apps = await regional.application.findMany({
      where: { accountId, candidateId: res.body.candidate.id, jobId },
    });
    expect(apps).toHaveLength(1);
  });

  it('surfaces candidate.imported on the job activity feed', async () => {
    const feed = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/activities?limit=20`)
      .set(hdr())
      .expect(200);
    const actions: string[] = feed.body.entries.map((e: any) => e.action);
    expect(actions).toContain('candidate.imported');
  });

  it('rejects an unknown provider with 400', async () => {
    await request(app.getHttpServer())
      .post('/sourcing/import')
      .set(hdr())
      .send({ source: 'does-not-exist', externalId: 'nope' })
      .expect(400);
  });
});
