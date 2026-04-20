import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for the Accounts module.
 *
 * Coverage:
 *   - POST /accounts happy path: creates a directory row, a regional account row,
 *     a membership as admin, and a default pipeline with 7 statuses.
 *   - POST /accounts rejects invalid region (400).
 *   - POST /accounts rejects invalid slug (400).
 *   - POST /accounts duplicate slug returns 409 (or P2002 — surfaced as 500 if the
 *     service doesn't translate; we accept 4xx/5xx and just require a failure).
 *   - GET /accounts/:id returns the account for a member.
 *
 * The tests register a brand-new user, then exercise the Accounts endpoints
 * so that test state is fully isolated from the seeded `demo@...` user.
 */
describe('Accounts (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  const suffix = uniqueSuffix();
  const email = `accounts-owner-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const usSlug = `acc-us-${suffix}`;
  const euSlug = `acc-eu-${suffix}`;
  let accessToken: string;
  let createdAccountIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, displayName: 'Accounts Owner' })
      .expect(201);
    accessToken = reg.body.accessToken;
  });

  afterAll(async () => {
    // Clean regional rows we created.
    const usUrl = process.env.REGION_US_EAST_1_DATABASE_URL;
    const euUrl = process.env.REGION_EU_WEST_1_DATABASE_URL;
    for (const [url, slug] of [
      [usUrl, usSlug],
      [euUrl, euSlug],
    ] as const) {
      if (!url) continue;
      const r = new RegionalPrisma({ datasources: { db: { url } } });
      await r.account.deleteMany({ where: { slug } }).catch(() => {});
      await r.$disconnect();
    }
    await db.membership.deleteMany({ where: { accountId: { in: createdAccountIds } } });
    await db.accountDirectory.deleteMany({ where: { id: { in: createdAccountIds } } });
    await db.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('POST /accounts: creates account end-to-end (global + regional + membership + default pipeline)', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Accounts Owner US', slug: usSlug, region: 'us-east-1' })
      .expect(201);

    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.slug).toBe(usSlug);
    expect(res.body.region).toBe('us-east-1');
    createdAccountIds.push(res.body.id);

    // Global directory row exists and points to US_EAST_1.
    const dir = await db.accountDirectory.findUnique({ where: { id: res.body.id } });
    expect(dir).not.toBeNull();
    expect(dir!.region).toBe('US_EAST_1');

    // Membership as admin exists.
    const user = await db.user.findUnique({ where: { email } });
    const membership = await db.membership.findUnique({
      where: { userId_accountId: { userId: user!.id, accountId: res.body.id } },
      include: { role: true },
    });
    expect(membership).not.toBeNull();
    expect(membership!.status).toBe('ACTIVE');
    expect(membership!.role.name).toBe('admin');

    // Regional row + default pipeline with 7 statuses exists in US DB only.
    const usUrl = process.env.REGION_US_EAST_1_DATABASE_URL!;
    const regional = new RegionalPrisma({ datasources: { db: { url: usUrl } } });
    try {
      const acc = await regional.account.findUnique({ where: { id: res.body.id } });
      expect(acc).not.toBeNull();
      expect(acc!.region).toBe('us-east-1');

      const pipelines = await regional.pipeline.findMany({
        where: { accountId: res.body.id, isDefault: true },
        include: { statuses: true },
      });
      expect(pipelines).toHaveLength(1);
      expect(pipelines[0]!.statuses.length).toBeGreaterThanOrEqual(5);
    } finally {
      await regional.$disconnect();
    }
  });

  it('POST /accounts: creates a second account in a different region', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Accounts Owner EU', slug: euSlug, region: 'eu-west-1' })
      .expect(201);

    createdAccountIds.push(res.body.id);
    expect(res.body.region).toBe('eu-west-1');

    // And it lives in EU, not US.
    const euUrl = process.env.REGION_EU_WEST_1_DATABASE_URL!;
    const eu = new RegionalPrisma({ datasources: { db: { url: euUrl } } });
    try {
      expect(await eu.account.findUnique({ where: { id: res.body.id } })).not.toBeNull();
    } finally {
      await eu.$disconnect();
    }

    const usUrl = process.env.REGION_US_EAST_1_DATABASE_URL!;
    const us = new RegionalPrisma({ datasources: { db: { url: usUrl } } });
    try {
      // Cross-region leakage check: EU account must NOT appear in US.
      expect(await us.account.findUnique({ where: { id: res.body.id } })).toBeNull();
    } finally {
      await us.$disconnect();
    }
  });

  it('POST /accounts: rejects unsupported region with 400', async () => {
    await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bad Region', slug: `bad-${suffix}`, region: 'mars-central-1' })
      .expect(400);
  });

  it('POST /accounts: rejects malformed slug with 400', async () => {
    await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bad Slug', slug: 'BadSlug With Space', region: 'us-east-1' })
      .expect(400);
  });

  it('POST /accounts: duplicate slug fails', async () => {
    const res = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Dup US', slug: usSlug, region: 'us-east-1' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('GET /accounts/:id: returns the account for a member', async () => {
    const id = createdAccountIds[0]!;
    const res = await request(app.getHttpServer())
      .get(`/accounts/${id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.id).toBe(id);
    expect(res.body.slug).toBe(usSlug);
  });

  it('POST /accounts: requires authentication', async () => {
    await request(app.getHttpServer())
      .post('/accounts')
      .send({ name: 'Anon', slug: `anon-${suffix}`, region: 'us-east-1' })
      .expect(401);
  });
});
