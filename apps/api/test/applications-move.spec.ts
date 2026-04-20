import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for the core Kanban operation: PATCH /applications/:id/move.
 *
 * The service guarantees:
 *   1. Positions are densely packed (0, 1, 2, ...) within each column after a move.
 *   2. Same-column reorders shift only the affected range (downward: gap closes; upward: gap opens).
 *   3. Cross-column moves close the gap in the source column and open space in the target column.
 *   4. An ApplicationTransition audit row is written for every move, with `from` and `to` status IDs.
 *   5. Moving to a status outside the job's pipeline is rejected (400).
 *
 * Strategy:
 *   Create one dedicated user + account + pipeline (4 statuses) + one job, then
 *   attach 4 candidates to column A. Exercise the moves and assert the DB state.
 */
describe('Applications.move (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const email = `kanban-owner-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `kanban-${suffix}`;
  let token: string;
  let accountId: string;
  let jobId: string;
  let statusIds: { a: string; b: string; c: string; d: string };
  let apps: { id: string; label: string }[] = [];
  let otherPipelineStatusId: string; // A status that belongs to a DIFFERENT pipeline

  const headers = () => ({ Authorization: `Bearer ${token}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    // 1. Register a fresh user.
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, displayName: 'Kanban Owner' })
      .expect(201);
    token = reg.body.accessToken;

    // 2. Create an account in us-east-1.
    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Kanban Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    // 3. Create a 4-column pipeline (the default is 7; we want something smaller & controlled).
    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(headers())
      .send({
        name: 'Test Pipeline',
        statuses: [
          { name: 'A', category: 'NEW' },
          { name: 'B', category: 'IN_PROGRESS' },
          { name: 'C', category: 'IN_PROGRESS' },
          { name: 'D', category: 'HIRED' },
        ],
      })
      .expect(201);
    statusIds = {
      a: pipelineRes.body.statuses[0].id,
      b: pipelineRes.body.statuses[1].id,
      c: pipelineRes.body.statuses[2].id,
      d: pipelineRes.body.statuses[3].id,
    };

    // 4. Create a job bound to this pipeline.
    const jobRes = await request(app.getHttpServer())
      .post('/jobs')
      .set(headers())
      .send({ title: 'Kanban Role', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobId = jobRes.body.id;

    // 5. Create 4 candidates + apply them; they all land in column A with positions 0..3.
    for (let i = 0; i < 4; i++) {
      const cand = await request(app.getHttpServer())
        .post('/candidates')
        .set(headers())
        .send({ firstName: 'C', lastName: `${i}-${suffix}` })
        .expect(201);
      const appRes = await request(app.getHttpServer())
        .post('/applications')
        .set(headers())
        .send({ candidateId: cand.body.id, jobId })
        .expect(201);
      apps.push({ id: appRes.body.id, label: `C${i}` });
    }

    // Sanity: positions 0..3 in column A.
    const inA = await regional.application.findMany({
      where: { jobId, currentStatusId: statusIds.a },
      orderBy: { position: 'asc' },
    });
    expect(inA.map((a) => a.position)).toEqual([0, 1, 2, 3]);

    // Create a status attached to a DIFFERENT pipeline so we can test rejection.
    const otherPipeline = await request(app.getHttpServer())
      .post('/pipelines')
      .set(headers())
      .send({
        name: 'Other Pipeline',
        statuses: [{ name: 'X', category: 'IN_PROGRESS' }],
      })
      .expect(201);
    otherPipelineStatusId = otherPipeline.body.statuses[0].id;
  });

  afterAll(async () => {
    // Delete in dependency order.
    await regional.applicationTransition.deleteMany({ where: { application: { jobId } } }).catch(() => {});
    await regional.application.deleteMany({ where: { jobId } });
    await regional.job.deleteMany({ where: { accountId } });
    await regional.candidate.deleteMany({ where: { accountId } });
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

  it('same-column move DOWN: C0 (pos 0) → pos 2 leaves positions densely [0,1,2,3]', async () => {
    // Before: A=[C0(0), C1(1), C2(2), C3(3)]
    // Move C0 to position 2. After: A=[C1(0), C2(1), C0(2), C3(3)]
    await request(app.getHttpServer())
      .patch(`/applications/${apps[0]!.id}/move`)
      .set(headers())
      .send({ toStatusId: statusIds.a, toPosition: 2 })
      .expect(200);

    const rows = await regional.application.findMany({
      where: { jobId, currentStatusId: statusIds.a },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    expect(rows[2]!.id).toBe(apps[0]!.id);
    expect(rows[0]!.id).toBe(apps[1]!.id); // C1 shifted up to 0
  });

  it('same-column move UP: move C3 (pos 3) → pos 0 leaves positions densely [0,1,2,3]', async () => {
    // Before: A=[C1(0), C2(1), C0(2), C3(3)]
    // Move C3 to position 0. After: A=[C3(0), C1(1), C2(2), C0(3)]
    await request(app.getHttpServer())
      .patch(`/applications/${apps[3]!.id}/move`)
      .set(headers())
      .send({ toStatusId: statusIds.a, toPosition: 0 })
      .expect(200);

    const rows = await regional.application.findMany({
      where: { jobId, currentStatusId: statusIds.a },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    expect(rows[0]!.id).toBe(apps[3]!.id);
  });

  it('cross-column move: moves a card from A to B at pos 0, repacks both columns', async () => {
    // Current A order is [C3, C1, C2, C0]. Move C1 (pos 1 in A) to B pos 0.
    await request(app.getHttpServer())
      .patch(`/applications/${apps[1]!.id}/move`)
      .set(headers())
      .send({ toStatusId: statusIds.b, toPosition: 0 })
      .expect(200);

    const a = await regional.application.findMany({
      where: { jobId, currentStatusId: statusIds.a },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
    const b = await regional.application.findMany({
      where: { jobId, currentStatusId: statusIds.b },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });

    // A must repack to [0,1,2], B must be [0].
    expect(a.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(b.map((r) => r.position)).toEqual([0]);
    expect(b[0]!.id).toBe(apps[1]!.id);

    // C1's currentStatusId must now be B.
    const moved = await regional.application.findUnique({ where: { id: apps[1]!.id } });
    expect(moved!.currentStatusId).toBe(statusIds.b);
  });

  it('writes an ApplicationTransition audit row with from/to status IDs', async () => {
    const transitions = await regional.applicationTransition.findMany({
      where: { applicationId: apps[1]!.id },
      orderBy: { createdAt: 'asc' },
    });
    // 1 creation transition (null → A) + 1 move (A → B) = 2.
    expect(transitions.length).toBeGreaterThanOrEqual(2);
    const lastMove = transitions[transitions.length - 1]!;
    expect(lastMove.fromStatusId).toBe(statusIds.a);
    expect(lastMove.toStatusId).toBe(statusIds.b);
    expect(lastMove.byUserId).toEqual(expect.any(String));
  });

  it('also writes an AuditEvent for the move', async () => {
    const events = await regional.auditEvent.findMany({
      where: { accountId, action: 'application.moved', resource: `application:${apps[1]!.id}` },
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a move to a status from a different pipeline with 400', async () => {
    await request(app.getHttpServer())
      .patch(`/applications/${apps[0]!.id}/move`)
      .set(headers())
      .send({ toStatusId: otherPipelineStatusId, toPosition: 0 })
      .expect(400);
  });

  it('rejects a move without x-account-id header (AccountGuard returns 403)', async () => {
    await request(app.getHttpServer())
      .patch(`/applications/${apps[0]!.id}/move`)
      .set('Authorization', `Bearer ${token}`)
      .send({ toStatusId: statusIds.a, toPosition: 0 })
      .expect(403);
  });

  it('rejects a move for an unknown application with 404', async () => {
    await request(app.getHttpServer())
      .patch('/applications/does-not-exist/move')
      .set(headers())
      .send({ toStatusId: statusIds.a, toPosition: 0 })
      .expect(404);
  });
});
