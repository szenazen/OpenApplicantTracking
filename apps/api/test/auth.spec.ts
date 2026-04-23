import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for the Auth module against a live global Postgres.
 *
 * Coverage:
 *   - POST /auth/register happy path returns tokens and creates a user row
 *   - POST /auth/register duplicate email returns 409
 *   - POST /auth/login wrong password returns 401 and increments failedAttempts
 *   - POST /auth/login correct password returns tokens and resets failedAttempts
 *   - GET  /auth/me with the token returns the user + (empty) accounts list
 *   - GET  /auth/me without token returns 401
 */
describe('Auth (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  const suffix = uniqueSuffix();
  const primaryEmail = `auth-primary-${suffix}@test.local`;
  const secondaryEmail = `auth-secondary-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    db = moduleRef.get(GlobalPrismaService);
  });

  afterAll(async () => {
    // Clean up only the users this suite created.
    await db.user.deleteMany({ where: { email: { in: [primaryEmail, secondaryEmail] } } });
    await app.close();
  });

  it('POST /auth/register: creates a user and returns tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: primaryEmail, password, displayName: 'Primary User' })
      .expect(201);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.expiresIn).toBeDefined();

    const user = await db.user.findUnique({ where: { email: primaryEmail } });
    expect(user).not.toBeNull();
    expect(user!.displayName).toBe('Primary User');
  });

  it('POST /auth/register: duplicate email returns 409', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: primaryEmail, password, displayName: 'Dup' })
      .expect(409);
  });

  it('POST /auth/register: rejects weak password with 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: secondaryEmail, password: 'short', displayName: 'Weak' })
      .expect(400);
  });

  it('POST /auth/login: wrong password returns 401 and increments failedAttempts', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: primaryEmail, password: 'not-the-password' })
      .expect(401);

    const cred = await db.authCredential.findUnique({ where: { userId: (await db.user.findUnique({ where: { email: primaryEmail } }))!.id } });
    expect(cred!.failedAttempts).toBeGreaterThanOrEqual(1);
  });

  it('POST /auth/login: correct password returns tokens and resets failedAttempts', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: primaryEmail, password })
      .expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));

    const user = await db.user.findUnique({ where: { email: primaryEmail } });
    const cred = await db.authCredential.findUnique({ where: { userId: user!.id } });
    expect(cred!.failedAttempts).toBe(0);
    expect(cred!.lastLoginAt).toBeInstanceOf(Date);
  });

  it('GET /auth/me: returns the authenticated user with accounts', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: primaryEmail, password })
      .expect(200);
    const token = login.body.accessToken as string;

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(me.body.email).toBe(primaryEmail);
    expect(me.body.displayName).toBe('Primary User');
    expect(me.body.platformAdmin).toBe(false);
    expect(Array.isArray(me.body.accounts)).toBe(true);
    // Brand-new user, no accounts yet.
    expect(me.body.accounts).toHaveLength(0);
  });

  it('GET /auth/me: returns 401 without a token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });
});
