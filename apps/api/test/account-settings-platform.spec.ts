import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for account settings (admin / account_manager), invitations,
 * platform provisioning, and guarded pipeline mutations.
 */
describe('Account settings, invitations, platform, pipeline admin', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;

  const suffix = uniqueSuffix();
  const adminEmail = `acctset-admin-${suffix}@test.local`;
  const mgrEmail = `acctset-mgr-${suffix}@test.local`;
  const recruitEmail = `acctset-recruit-${suffix}@test.local`;
  const invitedEmail = `acctset-invited-${suffix}@test.local`;
  const platEmail = `acctset-plat-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `acctset-${suffix}`;

  let adminToken: string;
  let mgrToken: string;
  let recruitToken: string;
  let invitedToken: string;
  let platToken: string;
  let accountId: string;
  let adminUserId: string;
  let mgrUserId: string;
  let recruitUserId: string;
  let invitedUserId: string;
  let platUserId: string;
  let defaultPipelineId: string;
  let extraStatusId: string;

  const adminHdr = () => ({ Authorization: `Bearer ${adminToken}`, 'x-account-id': accountId });
  const mgrHdr = () => ({ Authorization: `Bearer ${mgrToken}`, 'x-account-id': accountId });
  const recruitHdr = () => ({ Authorization: `Bearer ${recruitToken}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    for (const em of [adminEmail, mgrEmail, recruitEmail, invitedEmail, platEmail]) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: em, password, displayName: em.split('@')[0]! })
        .expect(201);
    }

    adminUserId = (await db.user.findUnique({ where: { email: adminEmail } }))!.id;
    mgrUserId = (await db.user.findUnique({ where: { email: mgrEmail } }))!.id;
    recruitUserId = (await db.user.findUnique({ where: { email: recruitEmail } }))!.id;
    invitedUserId = (await db.user.findUnique({ where: { email: invitedEmail } }))!.id;
    platUserId = (await db.user.findUnique({ where: { email: platEmail } }))!.id;

    const login = await request(app.getHttpServer()).post('/auth/login').send({ email: adminEmail, password }).expect(200);
    adminToken = login.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'AcctSet Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    const mgrRole = await db.role.findUnique({ where: { name: 'account_manager' } });
    const recRole = await db.role.findUnique({ where: { name: 'recruiter' } });
    if (!mgrRole || !recRole) {
      throw new Error('Expected account_manager and recruiter roles in global DB (run seed or migrations).');
    }

    await db.membership.create({
      data: { userId: mgrUserId, accountId, roleId: mgrRole.id, status: 'ACTIVE' },
    });
    await db.membership.create({
      data: { userId: recruitUserId, accountId, roleId: recRole.id, status: 'ACTIVE' },
    });

    const mLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: mgrEmail, password }).expect(200);
    mgrToken = mLogin.body.accessToken;
    const rLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: recruitEmail, password }).expect(200);
    recruitToken = rLogin.body.accessToken;

    await db.user.update({ where: { id: platUserId }, data: { platformAdmin: true } });
    const pLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: platEmail, password }).expect(200);
    platToken = pLogin.body.accessToken;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    const pipe = await regional.pipeline.findFirst({
      where: { accountId, isDefault: true },
      include: { statuses: true },
    });
    defaultPipelineId = pipe!.id;
    const extra = await regional.pipelineStatus.create({
      data: {
        pipelineId: defaultPipelineId,
        name: `Empty stage ${suffix}`,
        position: 99,
        category: 'IN_PROGRESS',
        color: '#999999',
      },
    });
    extraStatusId = extra.id;
  });

  afterAll(async () => {
    await regional.application.deleteMany({ where: { accountId } });
    await regional.candidate.deleteMany({ where: { accountId } });
    await regional.job.deleteMany({ where: { accountId } });
    await regional.jobMember.deleteMany({ where: { accountId } });
    await regional.pipelineStatus.deleteMany({ where: { pipeline: { accountId } } });
    await regional.pipeline.deleteMany({ where: { accountId } });
    await regional.auditEvent.deleteMany({ where: { accountId } });
    await regional.account.deleteMany({ where: { id: accountId } });
    await regional.$disconnect();

    await db.invitation.deleteMany({ where: { accountId } });
    await db.membership.deleteMany({ where: { accountId } });
    await db.accountDirectory.deleteMany({ where: { id: accountId } });
    await db.accountDirectory.deleteMany({ where: { slug: { startsWith: `plat-${suffix}` } } });
    await db.membership.deleteMany({ where: { userId: platUserId } });
    await db.user.deleteMany({
      where: { email: { in: [adminEmail, mgrEmail, recruitEmail, invitedEmail, platEmail] } },
    });
    await app.close();
  });

  it('GET /accounts/current/assignable-invite-roles: admin includes admin role', async () => {
    const res = await request(app.getHttpServer()).get('/accounts/current/assignable-invite-roles').set(adminHdr()).expect(200);
    const names = res.body.roles.map((r: { name: string }) => r.name);
    expect(names).toContain('admin');
  });

  it('GET /accounts/current/assignable-invite-roles: account_manager excludes admin', async () => {
    const res = await request(app.getHttpServer()).get('/accounts/current/assignable-invite-roles').set(mgrHdr()).expect(200);
    const names = res.body.roles.map((r: { name: string }) => r.name);
    expect(names).not.toContain('admin');
  });

  it('GET /accounts/current/assignable-invite-roles: recruiter is forbidden', async () => {
    await request(app.getHttpServer()).get('/accounts/current/assignable-invite-roles').set(recruitHdr()).expect(403);
  });

  it('account_manager cannot invite with admin role', async () => {
    await request(app.getHttpServer())
      .post('/invitations')
      .set(mgrHdr())
      .send({ email: `nobody-${suffix}@test.local`, role: 'admin' })
      .expect(403);
  });

  it('invitation create, accept, and membership', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/invitations')
      .set(adminHdr())
      .send({ email: invitedEmail, role: 'viewer' })
      .expect(201);
    expect(createRes.body.token).toEqual(expect.any(String));

    const iLogin = await request(app.getHttpServer()).post('/auth/login').send({ email: invitedEmail, password }).expect(200);
    invitedToken = iLogin.body.accessToken;

    await request(app.getHttpServer())
      .post('/auth/accept-invitation')
      .set('Authorization', `Bearer ${invitedToken}`)
      .send({ token: createRes.body.token })
      .expect(200);

    const row = await db.membership.findUnique({
      where: { userId_accountId: { userId: invitedUserId, accountId } },
      include: { role: true },
    });
    expect(row?.status).toBe('ACTIVE');
    expect(row?.role.name).toBe('viewer');
  });

  it('POST /accounts/current/members adds an existing user by email', async () => {
    const loneEmail = `acctset-lone-${suffix}@test.local`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: loneEmail, password, displayName: 'Lone' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/accounts/current/members')
      .set(adminHdr())
      .send({ email: loneEmail, role: 'viewer' })
      .expect(201);

    const u = await db.user.findUnique({ where: { email: loneEmail } });
    const m = await db.membership.findUnique({
      where: { userId_accountId: { userId: u!.id, accountId } },
    });
    expect(m?.status).toBe('ACTIVE');

    await db.membership.delete({ where: { userId_accountId: { userId: u!.id, accountId } } });
    await db.user.delete({ where: { email: loneEmail } });
  });

  it('DELETE /pipelines/:id/statuses/:id removes an unused stage', async () => {
    await request(app.getHttpServer())
      .delete(`/pipelines/${defaultPipelineId}/statuses/${extraStatusId}`)
      .set(adminHdr())
      .expect(200);
    const gone = await regional.pipelineStatus.findUnique({ where: { id: extraStatusId } });
    expect(gone).toBeNull();
  });

  it('DELETE pipeline status returns 400 when applications still reference it', async () => {
    const pipe = await regional.pipeline.findFirst({
      where: { accountId, isDefault: true },
      include: { statuses: { orderBy: { position: 'asc' } } },
    });
    const status = pipe!.statuses[0]!;
    const job = await regional.job.create({
      data: {
        accountId,
        title: `Job ${suffix}`,
        pipelineId: pipe!.id,
        status: 'PUBLISHED',
        ownerId: adminUserId,
      },
    });
    const cand = await regional.candidate.create({
      data: {
        accountId,
        firstName: 'T',
        lastName: 'Cand',
        email: `cand-${suffix}@test.local`,
      },
    });
    await regional.application.create({
      data: {
        accountId,
        jobId: job.id,
        candidateId: cand.id,
        currentStatusId: status.id,
        position: 0,
      },
    });

    const del = await request(app.getHttpServer())
      .delete(`/pipelines/${pipe!.id}/statuses/${status.id}`)
      .set(adminHdr());
    expect(del.status).toBe(400);

    await regional.application.deleteMany({ where: { jobId: job.id } });
    await regional.candidate.delete({ where: { id: cand.id } });
    await regional.job.delete({ where: { id: job.id } });
  });

  it('GET /platform/accounts: non-platform user is forbidden', async () => {
    await request(app.getHttpServer()).get('/platform/accounts').set('Authorization', `Bearer ${adminToken}`).expect(403);
  });

  it('GET /platform/accounts: platform admin lists accounts', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/accounts')
      .set('Authorization', `Bearer ${platToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((a: { slug: string }) => a.slug === slug)).toBe(true);
  });

  it('POST /platform/accounts: creates tenant for owner email', async () => {
    const pSlug = `plat-${suffix}`;
    const res = await request(app.getHttpServer())
      .post('/platform/accounts')
      .set('Authorization', `Bearer ${platToken}`)
      .send({
        name: `Platform Created ${suffix}`,
        slug: pSlug,
        region: 'us-east-1',
        ownerEmail: adminEmail,
      })
      .expect(201);
    expect(res.body.slug).toBe(pSlug);

    const dir = await db.accountDirectory.findUnique({ where: { slug: pSlug } });
    expect(dir).not.toBeNull();

    const regionalPlat = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });
    try {
      await regionalPlat.application.deleteMany({ where: { accountId: dir!.id } });
      await regionalPlat.candidate.deleteMany({ where: { accountId: dir!.id } });
      await regionalPlat.job.deleteMany({ where: { accountId: dir!.id } });
      await regionalPlat.jobMember.deleteMany({ where: { accountId: dir!.id } });
      await regionalPlat.pipelineStatus.deleteMany({ where: { pipeline: { accountId: dir!.id } } });
      await regionalPlat.pipeline.deleteMany({ where: { accountId: dir!.id } });
      await regionalPlat.account.deleteMany({ where: { id: dir!.id } });
    } finally {
      await regionalPlat.$disconnect();
    }
    await db.membership.deleteMany({ where: { accountId: dir!.id } });
    await db.accountDirectory.delete({ where: { id: dir!.id } });
  });
});
