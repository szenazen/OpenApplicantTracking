import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for the paginated + filtered GET /candidates endpoint.
 *
 * Scope:
 *   - keyset pagination (limit + nextCursor + exhaustion)
 *   - q substring search extended to title/company/headline/location
 *   - skillIds AND filter (candidate must have ALL of the given skills)
 *   - hasActive=true / hasActive=false buckets
 *   - minYoe / maxYoe inclusive bounds, null-yoe excluded
 *   - mostRecentApplicationId prefers non-terminal application
 *   - 400s on malformed params (hasActive, minYoe>maxYoe, negative limits, too many skillIds)
 */
describe('Candidates list (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const ownerEmail = `cand-list-owner-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `cand-list-${suffix}`;
  let ownerToken: string;
  let accountId: string;
  let jobId: string;
  // Second job so a candidate can have BOTH a hired application on one job
  // and an active application on another — needed to verify
  // mostRecentApplicationId prefers the non-terminal one.
  let otherJobId: string;
  let newStatusId: string;
  let hiredStatusId: string;

  // Global skill rows we'll attach to candidates for filter tests.
  let skillAlpha: { id: string };
  let skillBeta: { id: string };
  let skillGamma: { id: string };

  // Candidate ids so each test can reason about ordering.
  // Creation order drives createdAt DESC ordering of the list.
  // oldest -> newest:  c1, c2, c3, c4, c5
  let candidateIds: string[] = [];

  const hdr = () => ({ Authorization: `Bearer ${ownerToken}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ownerEmail, password, displayName: 'List Owner' })
      .expect(201);
    ownerToken = reg.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Candidate List Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    // 3 dedicated skills. They must exist in BOTH the global catalog
    // (source of truth) and the regional skill_cache (FK target for
    // candidate_skills.skillId). Seed replicates them asynchronously in
    // prod; here we do both up front so candidate creation doesn't 500.
    skillAlpha = await db.skill.upsert({
      where: { slug: `skill-alpha-${suffix}` },
      update: {},
      create: { slug: `skill-alpha-${suffix}`, name: `Alpha ${suffix}`, category: 'test' },
    });
    skillBeta = await db.skill.upsert({
      where: { slug: `skill-beta-${suffix}` },
      update: {},
      create: { slug: `skill-beta-${suffix}`, name: `Beta ${suffix}`, category: 'test' },
    });
    skillGamma = await db.skill.upsert({
      where: { slug: `skill-gamma-${suffix}` },
      update: {},
      create: { slug: `skill-gamma-${suffix}`, name: `Gamma ${suffix}`, category: 'test' },
    });
    for (const s of [skillAlpha, skillBeta, skillGamma]) {
      const full = await db.skill.findUnique({ where: { id: s.id } });
      if (!full) throw new Error('seeded skill missing');
      await regional.skillCache.upsert({
        where: { id: full.id },
        update: { name: full.name, slug: full.slug, category: full.category ?? null },
        create: { id: full.id, slug: full.slug, name: full.name, category: full.category ?? null },
      });
    }

    // Pipeline with a NEW and a HIRED column.
    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(hdr())
      .send({
        name: 'List Test Pipeline',
        statuses: [
          { name: 'Applied', category: 'NEW' },
          { name: 'Hired', category: 'HIRED' },
        ],
      })
      .expect(201);
    newStatusId = pipelineRes.body.statuses[0].id;
    hiredStatusId = pipelineRes.body.statuses[1].id;

    const jobRes = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({ title: 'List Test Role', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobId = jobRes.body.id;
    const otherJobRes = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({ title: 'List Test Role (past)', pipelineId: pipelineRes.body.id })
      .expect(201);
    otherJobId = otherJobRes.body.id;

    // Create 5 candidates with distinct profiles so filter assertions can
    // target them uniquely. `await` each + 5ms pause so createdAt is
    // strictly monotonic (keyset pagination otherwise ties on equal ts).
    const definitions = [
      {
        firstName: 'Anna',
        lastName: `Zephyr-${suffix}`,
        currentTitle: 'Junior Engineer',
        currentCompany: 'Acme',
        location: 'Austin, TX',
        yearsExperience: 1,
        skills: [skillAlpha.id], // only Alpha
        makeActiveApp: true,
      },
      {
        firstName: 'Bob',
        lastName: `Young-${suffix}`,
        currentTitle: 'Senior Engineer',
        currentCompany: 'Globex',
        location: 'Remote',
        yearsExperience: 5,
        skills: [skillAlpha.id, skillBeta.id], // Alpha AND Beta
        makeActiveApp: true,
      },
      {
        firstName: 'Cara',
        lastName: `Xeno-${suffix}`,
        currentTitle: 'Staff Engineer',
        currentCompany: 'Initech',
        location: 'New York',
        yearsExperience: 10,
        skills: [skillAlpha.id, skillBeta.id, skillGamma.id], // all three
        // No application at all — used for the hasActive=false bucket.
        makeActiveApp: false,
        makeHiredApp: false,
      },
      {
        firstName: 'Dan',
        lastName: `Walsh-${suffix}`,
        currentTitle: 'Engineering Manager',
        currentCompany: 'Initech',
        location: 'London',
        // null yoe on purpose — minYoe/maxYoe should exclude this row.
        yearsExperience: undefined as number | undefined,
        skills: [skillBeta.id], // only Beta
        makeActiveApp: false,
        makeHiredApp: true, // hired-only application => NOT active
      },
      {
        firstName: 'Eve',
        lastName: `Vault-${suffix}`,
        currentTitle: 'Junior Engineer',
        currentCompany: 'Acme',
        location: 'Austin, TX',
        yearsExperience: 3,
        skills: [skillAlpha.id, skillGamma.id], // Alpha AND Gamma (NOT Beta)
        makeActiveApp: true,
        // extra hired app so mostRecentApplicationId should still prefer the active one.
        makeHiredApp: true,
      },
    ];

    for (const def of definitions) {
      const body: Record<string, unknown> = {
        firstName: def.firstName,
        lastName: def.lastName,
        currentTitle: def.currentTitle,
        currentCompany: def.currentCompany,
        location: def.location,
      };
      if (typeof def.yearsExperience === 'number') body.yearsExperience = def.yearsExperience;
      if (def.skills?.length) body.skillIds = def.skills;
      const cand = await request(app.getHttpServer()).post('/candidates').set(hdr()).send(body).expect(201);
      candidateIds.push(cand.body.id);

      if (def.makeHiredApp) {
        // The hired application goes on `otherJobId` so Eve (who also has
        // an active app) doesn't collide on the unique (candidateId, jobId)
        // index on APPLICATIONS.
        const appRes = await request(app.getHttpServer())
          .post('/applications')
          .set(hdr())
          .send({ candidateId: cand.body.id, jobId: otherJobId })
          .expect(201);
        await request(app.getHttpServer())
          .patch(`/applications/${appRes.body.id}/move`)
          .set(hdr())
          .send({ toStatusId: hiredStatusId, toPosition: 0, reason: 'seeded hire' })
          .expect(200);
      }
      if (def.makeActiveApp) {
        await request(app.getHttpServer())
          .post('/applications')
          .set(hdr())
          .send({ candidateId: cand.body.id, jobId })
          .expect(201);
      }

      // Guarantee strictly increasing createdAt for keyset stability.
      await new Promise((r) => setTimeout(r, 10));
    }

    // Silence unused-var lint: newStatusId is read implicitly via POST /applications default.
    void newStatusId;
  });

  afterAll(async () => {
    await regional.applicationTransition
      .deleteMany({ where: { application: { jobId: { in: [jobId, otherJobId] } } } })
      .catch(() => {});
    await regional.application.deleteMany({ where: { jobId: { in: [jobId, otherJobId] } } });
    await regional.jobMember.deleteMany({ where: { accountId } });
    await regional.job.deleteMany({ where: { accountId } });
    await regional.candidateSkill.deleteMany({ where: { candidate: { accountId } } });
    await regional.candidate.deleteMany({ where: { accountId } });
    await regional.skillCache.deleteMany({ where: { id: { in: [skillAlpha.id, skillBeta.id, skillGamma.id] } } });
    await regional.pipelineStatus.deleteMany({ where: { pipeline: { accountId } } });
    await regional.pipeline.deleteMany({ where: { accountId } });
    await regional.auditEvent.deleteMany({ where: { accountId } });
    await regional.account.deleteMany({ where: { id: accountId } });
    await regional.$disconnect();
    await db.membership.deleteMany({ where: { accountId } });
    await db.accountDirectory.deleteMany({ where: { id: accountId } });
    await db.user.deleteMany({ where: { email: ownerEmail } });
    await db.skill.deleteMany({ where: { id: { in: [skillAlpha.id, skillBeta.id, skillGamma.id] } } });
    await app.close();
  });

  // ------------------------------------------------------------------
  // Pagination
  // ------------------------------------------------------------------
  it('returns paginated items with a working keyset cursor', async () => {
    const page1 = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: suffix, limit: 2 })
      .set(hdr())
      .expect(200);
    expect(Array.isArray(page1.body.items)).toBe(true);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    // Newest (Eve) first.
    expect(page1.body.items[0].firstName).toBe('Eve');
    expect(page1.body.items[1].firstName).toBe('Dan');

    const page2 = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: suffix, limit: 2, cursor: page1.body.nextCursor })
      .set(hdr())
      .expect(200);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.items[0].firstName).toBe('Cara');
    expect(page2.body.items[1].firstName).toBe('Bob');
    expect(page2.body.nextCursor).toBeTruthy();

    const page3 = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: suffix, limit: 2, cursor: page2.body.nextCursor })
      .set(hdr())
      .expect(200);
    expect(page3.body.items).toHaveLength(1);
    expect(page3.body.items[0].firstName).toBe('Anna');
    expect(page3.body.nextCursor).toBeNull();
  });

  // ------------------------------------------------------------------
  // Filters — q
  // ------------------------------------------------------------------
  it('q matches current title / company / location, not just name', async () => {
    // "Initech" is in currentCompany of Cara + Dan.
    const byCompany = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: 'Initech', limit: 100 })
      .set(hdr())
      .expect(200);
    const names = byCompany.body.items.map((i: { firstName: string }) => i.firstName).sort();
    expect(names).toContain('Cara');
    expect(names).toContain('Dan');

    // "Engineering Manager" → Dan's title only.
    const byTitle = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: 'Engineering Manager', limit: 100 })
      .set(hdr())
      .expect(200);
    expect(byTitle.body.items.map((i: { firstName: string }) => i.firstName)).toEqual(['Dan']);
  });

  // ------------------------------------------------------------------
  // Filters — skillIds (AND)
  // ------------------------------------------------------------------
  it('skillIds applies AND semantics (candidate must have every requested skill)', async () => {
    // Alpha alone → Anna, Bob, Cara, Eve (Dan has only Beta).
    const alphaOnly = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: suffix, skillIds: skillAlpha.id, limit: 100 })
      .set(hdr())
      .expect(200);
    const alphaNames = alphaOnly.body.items.map((i: { firstName: string }) => i.firstName).sort();
    expect(alphaNames).toEqual(['Anna', 'Bob', 'Cara', 'Eve']);

    // Alpha AND Beta → Bob, Cara only.
    const alphaAndBeta = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: suffix, skillIds: `${skillAlpha.id},${skillBeta.id}`, limit: 100 })
      .set(hdr())
      .expect(200);
    expect(alphaAndBeta.body.items.map((i: { firstName: string }) => i.firstName).sort()).toEqual(['Bob', 'Cara']);

    // Alpha AND Beta AND Gamma → Cara only.
    const all = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: suffix, skillIds: `${skillAlpha.id},${skillBeta.id},${skillGamma.id}`, limit: 100 })
      .set(hdr())
      .expect(200);
    expect(all.body.items.map((i: { firstName: string }) => i.firstName)).toEqual(['Cara']);
  });

  // ------------------------------------------------------------------
  // Filters — hasActive
  // ------------------------------------------------------------------
  it('hasActive=true returns only candidates with a non-terminal application', async () => {
    const res = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: suffix, hasActive: 'true', limit: 100 })
      .set(hdr())
      .expect(200);
    const names = res.body.items.map((i: { firstName: string }) => i.firstName).sort();
    // Anna, Bob, Eve have active apps. Cara has none. Dan's only app is HIRED.
    expect(names).toEqual(['Anna', 'Bob', 'Eve']);
  });

  it('hasActive=false returns only candidates with zero applications', async () => {
    const res = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: suffix, hasActive: 'false', limit: 100 })
      .set(hdr())
      .expect(200);
    expect(res.body.items.map((i: { firstName: string }) => i.firstName)).toEqual(['Cara']);
  });

  // ------------------------------------------------------------------
  // Filters — yoe bounds
  // ------------------------------------------------------------------
  it('minYoe / maxYoe bounds are inclusive and exclude null yoe', async () => {
    // 3..5 → Bob (5), Eve (3). Anna (1) too low. Cara (10) too high. Dan (null) excluded.
    const res = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: suffix, minYoe: 3, maxYoe: 5, limit: 100 })
      .set(hdr())
      .expect(200);
    expect(res.body.items.map((i: { firstName: string }) => i.firstName).sort()).toEqual(['Bob', 'Eve']);
  });

  // ------------------------------------------------------------------
  // mostRecentApplicationId
  // ------------------------------------------------------------------
  it('mostRecentApplicationId prefers a non-terminal application over a terminal one', async () => {
    const res = await request(app.getHttpServer())
      .get('/candidates')
      .query({ q: suffix, limit: 100 })
      .set(hdr())
      .expect(200);
    const eve = res.body.items.find((i: { firstName: string }) => i.firstName === 'Eve');
    expect(eve).toBeDefined();
    // Eve has 2 apps (1 HIRED, 1 NEW). mostRecent must point to the NEW one.
    expect(eve.mostRecentApplicationId).toBeTruthy();
    const [evRow] = await regional.application.findMany({
      where: { id: eve.mostRecentApplicationId },
      include: { currentStatus: { select: { category: true } } },
    });
    expect(evRow?.currentStatus.category).not.toBe('HIRED');
    expect(evRow?.currentStatus.category).not.toBe('DROPPED');

    const cara = res.body.items.find((i: { firstName: string }) => i.firstName === 'Cara');
    expect(cara.mostRecentApplicationId).toBeNull();
  });

  // ------------------------------------------------------------------
  // Bad input
  // ------------------------------------------------------------------
  it('rejects bad query params with 400', async () => {
    await request(app.getHttpServer())
      .get('/candidates')
      .query({ hasActive: 'maybe' })
      .set(hdr())
      .expect(400);

    await request(app.getHttpServer())
      .get('/candidates')
      .query({ minYoe: 5, maxYoe: 3 })
      .set(hdr())
      .expect(400);

    await request(app.getHttpServer())
      .get('/candidates')
      .query({ limit: -1 })
      .set(hdr())
      .expect(400);

    const tooManySkills = Array.from({ length: 21 }, (_, i) => `s${i}`).join(',');
    await request(app.getHttpServer())
      .get('/candidates')
      .query({ skillIds: tooManySkills })
      .set(hdr())
      .expect(400);
  });
});
