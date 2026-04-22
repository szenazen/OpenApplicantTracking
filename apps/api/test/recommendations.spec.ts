import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for Phase J — recommendations by skill overlap.
 *
 * Scenario under test:
 *   - A job requires a known set of skills (pulled from the regional skill
 *     cache, which is seeded by the dev seeds).
 *   - Three candidates with overlapping skill sets exist in the account.
 *   - One of them already has an application on this job and therefore must
 *     NOT appear in the recommendations list.
 *
 * We assert:
 *   - candidates are ranked by number of overlapping skills, highest first;
 *   - `matchedSkills` / `missingSkills` reconcile to `requiredSkills`;
 *   - candidates with zero overlap are excluded;
 *   - already-applied candidates are excluded;
 *   - a job with no required skills returns an empty list.
 */
describe('Recommendations (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const email = `rec-owner-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `rec-${suffix}`;

  let token: string;
  let accountId: string;
  let jobId: string;
  let jobNoSkillsId: string;
  let skillA: { id: string; name: string };
  let skillB: { id: string; name: string };
  let skillC: { id: string; name: string };
  let alreadyAppliedCandidateId: string;

  const hdr = () => ({ Authorization: `Bearer ${token}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, displayName: 'Rec Owner' })
      .expect(201);
    token = reg.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Rec Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    const cached = await regional.skillCache.findMany({ take: 3, orderBy: { name: 'asc' } });
    if (cached.length < 3) {
      throw new Error('skill_cache needs at least 3 rows — run `pnpm db:seed` before this suite.');
    }
    [skillA, skillB, skillC] = cached.map((c) => ({ id: c.id, name: c.name })) as [
      typeof skillA,
      typeof skillB,
      typeof skillC,
    ];

    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(hdr())
      .send({
        name: 'Rec Pipeline',
        statuses: [
          { name: 'Applied', category: 'NEW' },
          { name: 'Screen', category: 'IN_PROGRESS' },
        ],
      })
      .expect(201);

    const job = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({
        title: 'Rec Job',
        pipelineId: pipelineRes.body.id,
        requiredSkillIds: [skillA.id, skillB.id, skillC.id],
      })
      .expect(201);
    jobId = job.body.id;

    const jobNoSkills = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({ title: 'Rec Job No Skills', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobNoSkillsId = jobNoSkills.body.id;

    // Candidate "Three" — 3/3 overlap.
    await request(app.getHttpServer())
      .post('/candidates')
      .set(hdr())
      .send({
        firstName: 'Three',
        lastName: `Match-${suffix}`,
        skills: [{ skillId: skillA.id }, { skillId: skillB.id }, { skillId: skillC.id }],
      })
      .expect(201);

    // Candidate "Two" — 2/3 overlap, also already applied (should be excluded).
    const twoApplied = await request(app.getHttpServer())
      .post('/candidates')
      .set(hdr())
      .send({
        firstName: 'TwoApplied',
        lastName: `Match-${suffix}`,
        skills: [{ skillId: skillA.id }, { skillId: skillB.id }],
      })
      .expect(201);
    alreadyAppliedCandidateId = twoApplied.body.id;
    await request(app.getHttpServer())
      .post('/applications')
      .set(hdr())
      .send({ candidateId: alreadyAppliedCandidateId, jobId })
      .expect(201);

    // Candidate "TwoOpen" — 2/3 overlap, not yet applied (should be #2).
    await request(app.getHttpServer())
      .post('/candidates')
      .set(hdr())
      .send({
        firstName: 'TwoOpen',
        lastName: `Match-${suffix}`,
        skills: [{ skillId: skillA.id }, { skillId: skillC.id }],
      })
      .expect(201);

    // Candidate "Zero" — no required skill overlap (should be excluded).
    await request(app.getHttpServer())
      .post('/candidates')
      .set(hdr())
      .send({
        firstName: 'Zero',
        lastName: `Match-${suffix}`,
      })
      .expect(201);
  });

  afterAll(async () => {
    await regional.candidateSkill.deleteMany({ where: { candidate: { accountId } } });
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

  it('ranks by skill overlap and excludes applied / zero-overlap candidates', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/recommendations`)
      .set(hdr())
      .expect(200);

    expect(res.body.jobId).toBe(jobId);
    const requiredIds = new Set(res.body.requiredSkills.map((s: { id: string }) => s.id));
    expect(requiredIds).toEqual(new Set([skillA.id, skillB.id, skillC.id]));

    const names = res.body.candidates.map((c: any) => c.candidate.firstName);
    expect(names).toEqual(['Three', 'TwoOpen']);
    expect(names).not.toContain('TwoApplied');
    expect(names).not.toContain('Zero');

    const [top, second] = res.body.candidates;
    expect(top.score).toBe(3);
    expect(top.matchedSkills.map((s: any) => s.id).sort()).toEqual(
      [skillA.id, skillB.id, skillC.id].sort(),
    );
    expect(top.missingSkills).toHaveLength(0);

    expect(second.score).toBe(2);
    expect(new Set(second.matchedSkills.map((s: any) => s.id))).toEqual(
      new Set([skillA.id, skillC.id]),
    );
    expect(second.missingSkills.map((s: any) => s.id)).toEqual([skillB.id]);
  });

  it('returns an empty list when the job has no required skills', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobNoSkillsId}/recommendations`)
      .set(hdr())
      .expect(200);
    expect(res.body.requiredSkills).toEqual([]);
    expect(res.body.candidates).toEqual([]);
  });

  it('honours the `limit` query parameter', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/recommendations?limit=1`)
      .set(hdr())
      .expect(200);
    expect(res.body.candidates).toHaveLength(1);
    expect(res.body.candidates[0].candidate.firstName).toBe('Three');
  });

  it('404s on an unknown job id', async () => {
    await request(app.getHttpServer())
      .get(`/jobs/does-not-exist/recommendations`)
      .set(hdr())
      .expect(404);
  });

  it('returns a multi-signal scorePct and a breakdown per candidate', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/recommendations`)
      .set(hdr())
      .expect(200);
    const [top] = res.body.candidates;
    expect(top.scorePct).toBeGreaterThan(0);
    expect(top.scorePct).toBeLessThanOrEqual(100);
    expect(top.breakdown).toBeDefined();
    expect(typeof top.breakdown.skillsPct).toBe('number');
    expect(typeof top.breakdown.freshnessPct).toBe('number');
    expect(typeof top.breakdown.weights.skills).toBe('number');
    // 3/3 skill match should translate into a perfect skills sub-score.
    expect(top.breakdown.skillsPct).toBe(100);
    // Explanations are populated.
    expect(Array.isArray(top.reasons)).toBe(true);
    expect(top.reasons.length).toBeGreaterThan(0);
  });

  it('filters by the `q` query parameter (name / title / company search)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/recommendations?q=TwoOpen`)
      .set(hdr())
      .expect(200);
    const names = res.body.candidates.map((c: any) => c.candidate.firstName);
    expect(names).toEqual(['TwoOpen']);
  });

  it('filters by the `skillIds` intersection param', async () => {
    // Only "Three" has skillB; "TwoOpen" doesn't.
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/recommendations?skillIds=${skillB.id}`)
      .set(hdr())
      .expect(200);
    const names = res.body.candidates.map((c: any) => c.candidate.firstName);
    expect(names).toContain('Three');
    expect(names).not.toContain('TwoOpen');
  });

  it('rejects minYoe > maxYoe with a 400', async () => {
    await request(app.getHttpServer())
      .get(`/jobs/${jobId}/recommendations?minYoe=10&maxYoe=2`)
      .set(hdr())
      .expect(400);
  });
});
