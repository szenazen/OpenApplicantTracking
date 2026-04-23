import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for Phase H — job-level team (JobMember).
 *
 * Confirms the core contract:
 *   - only users with an ACTIVE account Membership can be added to a job,
 *   - (jobId, userId) is unique — second add is a 409,
 *   - role can be updated, and delete removes the row,
 *   - `GET /jobs/:id` surfaces the team list so the Kanban header can
 *     render avatars without a separate call,
 *   - `GET /accounts/current/members` powers the picker without leaking
 *     users outside the account.
 */
describe('Job team (JobMember integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const ownerEmail = `team-owner-${suffix}@test.local`;
  const memberEmail = `team-member-${suffix}@test.local`;
  const strangerEmail = `stranger-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `team-${suffix}`;

  let ownerToken: string;
  let ownerUserId: string;
  let accountId: string;
  let jobId: string;
  let memberUserId: string;
  let strangerUserId: string;

  const hdr = () => ({ Authorization: `Bearer ${ownerToken}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ownerEmail, password, displayName: 'Team Owner' })
      .expect(201);
    ownerToken = reg.body.accessToken;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: memberEmail, password, displayName: 'Team Member' })
      .expect(201);
    memberUserId = (await db.user.findUnique({ where: { email: memberEmail } }))!.id;
    ownerUserId = (await db.user.findUnique({ where: { email: ownerEmail } }))!.id;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: strangerEmail, password, displayName: 'Stranger' })
      .expect(201);
    strangerUserId = (await db.user.findUnique({ where: { email: strangerEmail } }))!.id;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Team Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    // Grant the member an ACTIVE account membership (the owner already has one).
    const adminRole = await db.role.findUnique({ where: { name: 'admin' } });
    await db.membership.create({
      data: { userId: memberUserId, accountId, roleId: adminRole!.id, status: 'ACTIVE' },
    });

    // Create a pipeline + job for the team to be attached to.
    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(hdr())
      .send({
        name: 'Team Pipeline',
        statuses: [
          { name: 'Applied', category: 'NEW' },
          { name: 'Screen', category: 'IN_PROGRESS' },
        ],
      })
      .expect(201);

    const job = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdr())
      .send({ title: 'Team Job', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobId = job.body.id;
  });

  afterAll(async () => {
    await regional.jobMember.deleteMany({ where: { accountId } });
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
    await db.user.deleteMany({ where: { email: { in: [ownerEmail, memberEmail, strangerEmail] } } });
    await app.close();
  });

  it('lists the account members (used by the picker)', async () => {
    const res = await request(app.getHttpServer())
      .get('/accounts/current/members')
      .set(hdr())
      .expect(200);
    const emails = res.body.map((m: any) => m.email).sort();
    expect(emails).toEqual([memberEmail, ownerEmail].sort());
    // Stranger must not appear — they are not a member of this account.
    expect(emails).not.toContain(strangerEmail);
  });

  it('adds, lists, updates and removes a job member', async () => {
    // Add.
    const addRes = await request(app.getHttpServer())
      .post(`/jobs/${jobId}/members`)
      .set(hdr())
      .send({ userId: memberUserId, role: 'HIRING_MANAGER' })
      .expect(201);
    expect(addRes.body.role).toBe('HIRING_MANAGER');
    expect(addRes.body.user.email).toBe(memberEmail);
    const jobMemberId = addRes.body.id;

    // List.
    const listRes = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/members`)
      .set(hdr())
      .expect(200);
    // Creator is auto-added as OWNER; we added HIRING_MANAGER.
    expect(listRes.body).toHaveLength(2);
    const userIds = listRes.body.map((m: { userId: string }) => m.userId).sort();
    expect(userIds).toEqual([memberUserId, ownerUserId].sort());

    // Second add with the same user is a 409 (unique (jobId, userId)).
    await request(app.getHttpServer())
      .post(`/jobs/${jobId}/members`)
      .set(hdr())
      .send({ userId: memberUserId, role: 'RECRUITER' })
      .expect(409);

    // Patch role.
    const patchRes = await request(app.getHttpServer())
      .patch(`/job-members/${jobMemberId}`)
      .set(hdr())
      .send({ role: 'INTERVIEWER' })
      .expect(200);
    expect(patchRes.body.role).toBe('INTERVIEWER');

    // Delete.
    await request(app.getHttpServer())
      .delete(`/job-members/${jobMemberId}`)
      .set(hdr())
      .expect(200);

    const emptyList = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/members`)
      .set(hdr())
      .expect(200);
    expect(emptyList.body).toHaveLength(1);
    expect(emptyList.body[0].userId).toBe(ownerUserId);
  });

  it('rejects adding a user who is not an active member of the account', async () => {
    await request(app.getHttpServer())
      .post(`/jobs/${jobId}/members`)
      .set(hdr())
      .send({ userId: strangerUserId })
      .expect(403);
  });

  it('surfaces the team list on GET /jobs/:id alongside applications', async () => {
    await request(app.getHttpServer())
      .post(`/jobs/${jobId}/members`)
      .set(hdr())
      .send({ userId: memberUserId, role: 'RECRUITER' })
      .expect(201);
    const res = await request(app.getHttpServer())
      .get(`/jobs/${jobId}`)
      .set(hdr())
      .expect(200);
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.members.some((m: any) => m.userId === memberUserId)).toBe(true);
  });

  it('writes a job-member.added audit event that surfaces on the Activities feed', async () => {
    const feed = await request(app.getHttpServer())
      .get(`/jobs/${jobId}/activities?limit=20`)
      .set(hdr())
      .expect(200);
    const actions: string[] = feed.body.entries.map((e: any) => e.action);
    expect(actions).toContain('job-member.added');
  });
});
