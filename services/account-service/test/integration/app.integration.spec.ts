import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaClient, Region } from '../../src/generated/prisma';
import { uniqueSuffix } from '../helpers/unique-suffix';

/**
 * Exercises real HTTP + global Prisma (same DB as monolith migrations).
 * Requires Postgres reachable at GLOBAL_DATABASE_URL (CI api-tests job).
 */
describe('account-service HTTP (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let jwt: JwtService;
  const suffix = uniqueSuffix();
  const adminEmail = `as-admin-${suffix}@test.local`;
  const memberEmail = `as-member-${suffix}@test.local`;
  const platEmail = `as-plat-${suffix}@test.local`;
  let accountId: string;
  let adminUserId: string;
  let platUserId: string;
  let adminToken: string;
  let platToken: string;
  let adminRoleId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    jwt = moduleRef.get(JwtService);

    adminRoleId = (
      await prisma.role.upsert({
        where: { name: 'admin' },
        create: { name: 'admin', scope: 'ACCOUNT', isSystem: true },
        update: {},
      })
    ).id;

    await prisma.role.upsert({
      where: { name: 'viewer' },
      create: { name: 'viewer', scope: 'ACCOUNT', isSystem: true },
      update: {},
    });

    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        displayName: 'AS Admin',
        status: 'ACTIVE',
      },
    });
    adminUserId = adminUser.id;

    await prisma.user.create({
      data: {
        email: memberEmail,
        displayName: 'AS Member',
        status: 'ACTIVE',
      },
    });

    const platUser = await prisma.user.create({
      data: {
        email: platEmail,
        displayName: 'AS Platform',
        status: 'ACTIVE',
        platformAdmin: true,
      },
    });
    platUserId = platUser.id;

    const acc = await prisma.accountDirectory.create({
      data: {
        name: `AS Co ${suffix}`,
        slug: `as-co-${suffix}`,
        region: Region.US_EAST_1,
        ownerUserId: adminUserId,
      },
    });
    accountId = acc.id;

    await prisma.membership.create({
      data: {
        userId: adminUserId,
        accountId,
        roleId: adminRoleId,
        status: 'ACTIVE',
      },
    });

    adminToken = jwt.sign({ sub: adminUserId, email: adminEmail });
    platToken = jwt.sign({ sub: platUserId, email: platEmail });
  });

  afterAll(async () => {
    try {
      await prisma.invitation.deleteMany({ where: { accountId } });
      await prisma.membership.deleteMany({ where: { accountId } });
      await prisma.accountDirectory.delete({ where: { id: accountId } });
      await prisma.user.deleteMany({
        where: { email: { in: [adminEmail, memberEmail, platEmail] } },
      });
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });

  const auth = () => ({ Authorization: `Bearer ${adminToken}`, 'x-account-id': accountId });

  it('GET /health', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.service).toBe('account-service');
  });

  it('GET /api/accounts/:id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/accounts/${accountId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body._service).toBe('account-service');
    expect(res.body.slug).toContain('as-co-');
  });

  it('GET /api/accounts/current/members', async () => {
    const res = await request(app.getHttpServer()).get('/api/accounts/current/members').set(auth()).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((m: { email: string }) => m.email === adminEmail)).toBe(true);
  });

  it('GET /api/accounts/current/assignable-invite-roles', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/accounts/current/assignable-invite-roles')
      .set(auth())
      .expect(200);
    expect(res.body.roles).toBeDefined();
    expect(res.body.roles.some((r: { name: string }) => r.name === 'admin')).toBe(true);
  });

  it('POST /api/accounts/current/members adds existing user', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/accounts/current/members')
      .set(auth())
      .send({ email: memberEmail, role: 'viewer' });
    expect([200, 201]).toContain(res.status);
    const member = await prisma.user.findUnique({ where: { email: memberEmail } });
    const m = await prisma.membership.findUnique({
      where: { userId_accountId: { userId: member!.id, accountId } },
    });
    expect(m?.status).toBe('ACTIVE');
  });

  it('POST /api/invitations, GET list, DELETE revoke', async () => {
    const inviteEmail = `invite-${suffix}@test.local`;
    const createRes = await request(app.getHttpServer())
      .post('/api/invitations')
      .set(auth())
      .send({ email: inviteEmail, role: 'viewer' });
    expect([200, 201]).toContain(createRes.status);
    expect(createRes.body.token).toBeDefined();

    const listRes = await request(app.getHttpServer()).get('/api/invitations').set(auth()).expect(200);
    expect(listRes.body.some((i: { id: string }) => i.id === createRes.body.id)).toBe(true);

    await request(app.getHttpServer()).delete(`/api/invitations/${createRes.body.id}`).set(auth()).expect(200);
  });

  it('GET /api/platform/accounts: non-platform user is forbidden', async () => {
    await request(app.getHttpServer())
      .get('/api/platform/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
  });

  it('GET /api/platform/accounts: platform admin lists directory', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/platform/accounts')
      .set('Authorization', `Bearer ${platToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((a: { slug: string }) => a.slug === `as-co-${suffix}`)).toBe(true);
  });
});
