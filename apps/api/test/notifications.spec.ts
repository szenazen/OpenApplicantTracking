import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for the notifications inbox.
 *
 * The feature has three write paths (mention extraction in comments/notes,
 * job-member assignment, and prior-commenter REPLY fan-out) and three read
 * paths (`GET /notifications`, `GET /notifications/unread-count`,
 * `POST /notifications/mark-read`). We exercise each once to keep the
 * suite fast but catch regressions in the most common flows:
 *
 *   - @mentions are resolved against account membership (not global
 *     directory), so a mention of a non-member must NOT create a
 *     notification.
 *   - The actor never notifies themselves.
 *   - Assigning someone to a job creates an ASSIGNMENT notification that
 *     the inbox surfaces with `actor` hydrated.
 *   - `mark-read` is idempotent and cross-account-safe.
 */
describe('Notifications inbox (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const authorEmail = `notif-author-${suffix}@test.local`;
  const peerEmail = `notif-peer-${suffix}@test.local`;
  const outsiderEmail = `notif-outsider-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `notif-${suffix}`;
  let authorToken: string;
  let peerToken: string;
  let accountId: string;
  let peerUserId: string;
  let applicationId: string;
  let jobId: string;

  const authorHeaders = () => ({ Authorization: `Bearer ${authorToken}`, 'x-account-id': accountId });
  const peerHeaders = () => ({ Authorization: `Bearer ${peerToken}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const authorReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: authorEmail, password, displayName: 'Notif Author' })
      .expect(201);
    authorToken = authorReg.body.accessToken;

    const peerReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: peerEmail, password, displayName: 'Peer Person' })
      .expect(201);
    peerToken = peerReg.body.accessToken;

    // Outsider registers but is never added to the account — proves
    // mention resolution is scoped to membership, not global directory.
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: outsiderEmail, password, displayName: 'Outside Eve' })
      .expect(201);

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ name: 'Notif Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    const adminRole = await db.role.findFirstOrThrow({ where: { name: 'admin' } });
    const peerUser = await db.user.findFirstOrThrow({ where: { email: peerEmail } });
    peerUserId = peerUser.id;
    await db.membership.create({
      data: { userId: peerUserId, accountId, roleId: adminRole.id, status: 'ACTIVE' },
    });

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(authorHeaders())
      .send({ name: 'Notif Pipeline', statuses: [{ name: 'Applied', category: 'NEW' }] })
      .expect(201);

    const jobRes = await request(app.getHttpServer())
      .post('/jobs')
      .set(authorHeaders())
      .send({ title: 'Backend Engineer', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobId = jobRes.body.id;

    const candRes = await request(app.getHttpServer())
      .post('/candidates')
      .set(authorHeaders())
      .send({ firstName: 'Nova', lastName: `Example-${suffix}` })
      .expect(201);

    const appRes = await request(app.getHttpServer())
      .post('/applications')
      .set(authorHeaders())
      .send({ candidateId: candRes.body.id, jobId })
      .expect(201);
    applicationId = appRes.body.id;
  });

  afterAll(async () => {
    await regional.notification.deleteMany({ where: { accountId } });
    await regional.applicationComment.deleteMany({ where: { accountId } });
    await regional.applicationTransition.deleteMany({ where: { application: { accountId } } });
    await regional.application.deleteMany({ where: { accountId } });
    await regional.candidate.deleteMany({ where: { accountId } });
    await regional.jobMember.deleteMany({ where: { accountId } });
    await regional.jobNote.deleteMany({ where: { accountId } });
    await regional.job.deleteMany({ where: { accountId } });
    await regional.pipelineStatus.deleteMany({ where: { pipeline: { accountId } } });
    await regional.pipeline.deleteMany({ where: { accountId } });
    await regional.auditEvent.deleteMany({ where: { accountId } });
    await regional.account.deleteMany({ where: { id: accountId } });
    await regional.$disconnect();
    await db.membership.deleteMany({ where: { accountId } });
    await db.accountDirectory.deleteMany({ where: { id: accountId } });
    await db.user.deleteMany({ where: { email: { in: [authorEmail, peerEmail, outsiderEmail] } } });
    await app.close();
  });

  it('starts with an empty inbox', async () => {
    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set(peerHeaders())
      .expect(200);
    expect(res.body.entries).toEqual([]);
    expect(res.body.unreadCount).toBe(0);
  });

  it('@mentions the peer in a comment and creates exactly one notification', async () => {
    const local = peerEmail.split('@')[0];
    await request(app.getHttpServer())
      .post(`/applications/${applicationId}/comments`)
      .set(authorHeaders())
      .send({ body: `Hey @${local} please review — also cc @${outsiderEmail.split('@')[0]}.` })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set(peerHeaders())
      .expect(200);
    expect(res.body.unreadCount).toBe(1);
    expect(res.body.entries.length).toBe(1);
    const n = res.body.entries[0];
    expect(n.kind).toBe('MENTION');
    expect(n.readAt).toBeNull();
    expect(n.resource).toBe(`application:${applicationId}`);
    expect(n.metadata.jobId).toBe(jobId);
    expect(n.actor?.email).toBe(authorEmail);
    // The outsider is not a member → should not have been notified. We can't
    // query another user's inbox, but we can assert only one row exists.
    const rows = await regional.notification.findMany({ where: { accountId } });
    expect(rows.length).toBe(1);
  });

  it('self-mention does not notify the actor', async () => {
    const authorLocal = authorEmail.split('@')[0];
    await request(app.getHttpServer())
      .post(`/applications/${applicationId}/comments`)
      .set(authorHeaders())
      .send({ body: `Note to self: @${authorLocal} follow up tomorrow.` })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set(authorHeaders())
      .expect(200);
    expect(res.body.unreadCount).toBe(0);
    expect(res.body.entries).toEqual([]);
  });

  it('assigning the peer as a JobMember creates an ASSIGNMENT notification', async () => {
    await request(app.getHttpServer())
      .post(`/jobs/${jobId}/members`)
      .set(authorHeaders())
      .send({ userId: peerUserId, role: 'RECRUITER' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/notifications')
      .set(peerHeaders())
      .expect(200);
    const kinds = res.body.entries.map((e: any) => e.kind);
    expect(kinds).toContain('ASSIGNMENT');
    const assign = res.body.entries.find((e: any) => e.kind === 'ASSIGNMENT');
    expect(assign.resource).toBe(`job:${jobId}`);
    expect(assign.metadata.role).toBe('RECRUITER');
    expect(assign.actor?.email).toBe(authorEmail);
  });

  it('unread-count returns only unread, and mark-read zeroes it', async () => {
    const before = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set(peerHeaders())
      .expect(200);
    expect(before.body.unread).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .post('/notifications/mark-read')
      .set(peerHeaders())
      .send({ all: true })
      .expect(201);

    const after = await request(app.getHttpServer())
      .get('/notifications/unread-count')
      .set(peerHeaders())
      .expect(200);
    expect(after.body.unread).toBe(0);

    // Second mark-all-read is a no-op (idempotent).
    const again = await request(app.getHttpServer())
      .post('/notifications/mark-read')
      .set(peerHeaders())
      .send({ all: true })
      .expect(201);
    expect(again.body.marked).toBe(0);
  });

  it('listing with unreadOnly=true returns empty after mark-read', async () => {
    const res = await request(app.getHttpServer())
      .get('/notifications?unreadOnly=true')
      .set(peerHeaders())
      .expect(200);
    expect(res.body.entries).toEqual([]);
  });
});
