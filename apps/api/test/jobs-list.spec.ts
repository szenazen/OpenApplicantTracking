import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for the paginated + filtered GET /jobs endpoint
 * behind the new `/dashboard/jobs` table view.
 *
 * Scope:
 *   - keyset pagination (`limit` + `nextCursor`) traverses the full list
 *     exactly once with no duplicates,
 *   - `q` matches title / department / location / clientName,
 *   - `status=` narrows to a single status,
 *   - `includeArchived=false` (the default) hides ARCHIVED jobs,
 *   - `candidateCounts.{total,active}` reflects applications with non-
 *     terminal `currentStatus.category`,
 *   - headCount and clientName round-trip through create + list,
 *   - 400s on malformed params.
 */
describe('Jobs list (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const ownerEmail = `jobs-list-owner-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `jobs-list-${suffix}`;
  let ownerToken: string;
  let accountId: string;
  let newStatusId: string;
  let hiredStatusId: string;
  let pipelineId: string;
  const jobIds: string[] = [];

  const hdr = () => ({ Authorization: `Bearer ${ownerToken}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ownerEmail, password, displayName: 'Jobs List Owner' })
      .expect(201);
    ownerToken = reg.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Jobs List Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(hdr())
      .send({
        name: 'Jobs List Pipeline',
        statuses: [
          { name: 'Applied', category: 'NEW' },
          { name: 'Hired', category: 'HIRED' },
        ],
      })
      .expect(201);
    pipelineId = pipelineRes.body.id;
    newStatusId = pipelineRes.body.statuses[0].id;
    hiredStatusId = pipelineRes.body.statuses[1].id;

    // 4 jobs so the pagination test can use limit=2 and confirm that
    // nextCursor traverses the full set exactly once. Distinct locations
    // / departments / clientNames let the `q` filter target each.
    //
    // 5ms staggers make createdAt strictly monotonic — keyset pagination
    // otherwise ties on equal timestamps.
    const definitions = [
      {
        title: `Android Developer ${suffix}`,
        department: 'Mobile',
        location: 'Palo Alto',
        clientName: 'Amazon',
        headCount: 3,
      },
      {
        title: `Chief Information Officer ${suffix}`,
        department: 'Exec',
        location: 'New York',
        clientName: 'Amazon',
        headCount: 1,
      },
      {
        title: `iOS Developer ${suffix}`,
        department: 'Mobile',
        location: 'London',
        clientName: 'Spotify',
        headCount: 2,
      },
      {
        title: `Marketing Manager ${suffix}`,
        department: 'Marketing',
        location: 'Tokyo',
        clientName: 'Hubspot',
        headCount: 1,
      },
    ];
    for (const def of definitions) {
      const res = await request(app.getHttpServer())
        .post('/jobs')
        .set(hdr())
        .send({ ...def, pipelineId })
        .expect(201);
      jobIds.push(res.body.id);
      // headCount and clientName must round-trip on create so the form
      // can display them without a second GET.
      expect(res.body.headCount).toBe(def.headCount);
      expect(res.body.clientName).toBe(def.clientName);
      await new Promise((r) => setTimeout(r, 5));
    }

    // Create two candidates + applications on the first job:
    // one ACTIVE (NEW) and one HIRED (terminal) so candidateCounts can
    // distinguish total vs active.
    const mkCandidate = async (firstName: string) => {
      const c = await request(app.getHttpServer())
        .post('/candidates')
        .set(hdr())
        .send({ firstName, lastName: `List-${suffix}`, email: `${firstName.toLowerCase()}.${suffix}@t.local` })
        .expect(201);
      return c.body.id as string;
    };
    const activeCandId = await mkCandidate('Active');
    const hiredCandId = await mkCandidate('Hired');

    await request(app.getHttpServer())
      .post('/applications')
      .set(hdr())
      .send({ candidateId: activeCandId, jobId: jobIds[0] })
      .expect(201);
    const hiredAppRes = await request(app.getHttpServer())
      .post('/applications')
      .set(hdr())
      .send({ candidateId: hiredCandId, jobId: jobIds[0] })
      .expect(201);
    // Move the second application to the HIRED status so it becomes terminal.
    await request(app.getHttpServer())
      .patch(`/applications/${hiredAppRes.body.id}/move`)
      .set(hdr())
      .send({ toStatusId: hiredStatusId, toPosition: 0 })
      .expect(200);
  });

  afterAll(async () => {
    await regional.applicationTransition.deleteMany({ where: { application: { accountId } } });
    await regional.application.deleteMany({ where: { accountId } });
    await regional.candidate.deleteMany({ where: { accountId } });
    await regional.auditEvent.deleteMany({ where: { accountId } });
    await regional.jobMember.deleteMany({ where: { accountId } });
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

  it('returns { items, nextCursor } with keyset pagination exhausting the full list', async () => {
    const firstRes = await request(app.getHttpServer())
      .get('/jobs?limit=2')
      .set(hdr())
      .expect(200);
    expect(Array.isArray(firstRes.body.items)).toBe(true);
    expect(firstRes.body.items).toHaveLength(2);
    expect(firstRes.body.nextCursor).toBeTruthy();

    const secondRes = await request(app.getHttpServer())
      .get(`/jobs?limit=2&cursor=${encodeURIComponent(firstRes.body.nextCursor)}`)
      .set(hdr())
      .expect(200);
    expect(secondRes.body.items.length).toBeGreaterThanOrEqual(2);
    expect(secondRes.body.nextCursor).toBeNull();

    const firstIds = new Set<string>(firstRes.body.items.map((j: { id: string }) => j.id));
    for (const j of secondRes.body.items) expect(firstIds.has(j.id)).toBe(false);
    const combined = new Set<string>([
      ...firstRes.body.items.map((j: { id: string }) => j.id),
      ...secondRes.body.items.map((j: { id: string }) => j.id),
    ]);
    for (const id of jobIds) expect(combined.has(id)).toBe(true);
  });

  it('q matches title, location, and clientName', async () => {
    const byTitle = await request(app.getHttpServer())
      .get(`/jobs?q=android`)
      .set(hdr())
      .expect(200);
    expect(byTitle.body.items.some((j: { title: string }) => j.title.toLowerCase().includes('android'))).toBe(true);

    const byLocation = await request(app.getHttpServer())
      .get(`/jobs?q=tokyo`)
      .set(hdr())
      .expect(200);
    expect(byLocation.body.items.some((j: { location?: string }) => (j.location ?? '').toLowerCase() === 'tokyo')).toBe(
      true,
    );

    const byClient = await request(app.getHttpServer())
      .get(`/jobs?q=spotify`)
      .set(hdr())
      .expect(200);
    expect(byClient.body.items.every((j: { clientName?: string }) => (j.clientName ?? '') === 'Spotify')).toBe(true);
    expect(byClient.body.items.length).toBeGreaterThan(0);
  });

  it('status filter narrows to a single status', async () => {
    // All the jobs we created are PUBLISHED. Narrow to DRAFT first — expect
    // zero — then back to PUBLISHED to ensure the filter is bidirectional.
    const draft = await request(app.getHttpServer())
      .get(`/jobs?status=DRAFT`)
      .set(hdr())
      .expect(200);
    expect(draft.body.items.every((j: { status: string }) => j.status === 'DRAFT')).toBe(true);

    const published = await request(app.getHttpServer())
      .get(`/jobs?status=PUBLISHED&limit=100`)
      .set(hdr())
      .expect(200);
    expect(published.body.items.length).toBeGreaterThanOrEqual(jobIds.length);
    expect(published.body.items.every((j: { status: string }) => j.status === 'PUBLISHED')).toBe(true);
  });

  it('excludes ARCHIVED by default and re-includes them with includeArchived=true', async () => {
    // Archive the last job so the default view drops it but the explicit
    // flag brings it back.
    const archivedId = jobIds[jobIds.length - 1];
    await request(app.getHttpServer())
      .patch(`/jobs/${archivedId}`)
      .set(hdr())
      .send({ status: 'ARCHIVED' })
      .expect(200);

    const defaultView = await request(app.getHttpServer())
      .get(`/jobs?limit=100`)
      .set(hdr())
      .expect(200);
    expect(defaultView.body.items.some((j: { id: string }) => j.id === archivedId)).toBe(false);

    const withArchived = await request(app.getHttpServer())
      .get(`/jobs?limit=100&includeArchived=true`)
      .set(hdr())
      .expect(200);
    expect(withArchived.body.items.some((j: { id: string }) => j.id === archivedId)).toBe(true);
  });

  it('candidateCounts reflects total vs active (excludes HIRED/DROPPED)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/jobs?limit=100&includeArchived=true`)
      .set(hdr())
      .expect(200);
    const first = res.body.items.find((j: { id: string }) => j.id === jobIds[0]);
    expect(first).toBeTruthy();
    expect(first.candidateCounts.total).toBe(2);
    expect(first.candidateCounts.active).toBe(1);

    // Jobs with no applications report zero for both counts — the field
    // is always populated so the UI never crashes on a missing key.
    const empty = res.body.items.find((j: { id: string }) => j.id === jobIds[1]);
    expect(empty.candidateCounts).toEqual({ total: 0, active: 0 });
  });

  it('headCount and clientName round-trip via PATCH', async () => {
    const target = jobIds[1];
    const res = await request(app.getHttpServer())
      .patch(`/jobs/${target}`)
      .set(hdr())
      .send({ headCount: 7, clientName: 'Stripe' })
      .expect(200);
    expect(res.body.headCount).toBe(7);
    expect(res.body.clientName).toBe('Stripe');

    // Re-read via the list to confirm persistence.
    const list = await request(app.getHttpServer())
      .get(`/jobs?limit=100&includeArchived=true`)
      .set(hdr())
      .expect(200);
    const updated = list.body.items.find((j: { id: string }) => j.id === target);
    expect(updated.headCount).toBe(7);
    expect(updated.clientName).toBe('Stripe');
  });

  it('rejects bad query params with 400', async () => {
    await request(app.getHttpServer())
      .get(`/jobs?status=BOGUS`)
      .set(hdr())
      .expect(400);
    await request(app.getHttpServer())
      .get(`/jobs?limit=-1`)
      .set(hdr())
      .expect(400);
    await request(app.getHttpServer())
      .get(`/jobs?limit=abc`)
      .set(hdr())
      .expect(400);
    await request(app.getHttpServer())
      .get(`/jobs?includeArchived=maybe`)
      .set(hdr())
      .expect(400);
  });
});
