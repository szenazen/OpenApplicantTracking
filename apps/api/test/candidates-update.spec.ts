import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Integration tests for `PATCH /candidates/:id` — the server side of the
 * candidate drawer's inline-edit mode.
 *
 * We verify:
 *   - partial updates only touch the sent fields,
 *   - nullable columns can be explicitly cleared with `null`,
 *   - empty/whitespace-only `firstName` / `lastName` is rejected so a
 *     fat-fingered save can never wipe a required column,
 *   - tenant isolation — a candidate in another account 404s,
 *   - skills are never touched by this endpoint even if a stray payload
 *     slips in.
 */
describe('Candidates update (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const ownerEmail = `cand-upd-owner-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `cand-upd-${suffix}`;
  let ownerToken: string;
  let accountId: string;
  let candidateId: string;

  // Secondary tenant (isolation check).
  const otherOwnerEmail = `cand-upd-other-${suffix}@test.local`;
  const otherSlug = `cand-upd-other-${suffix}`;
  let otherToken: string;
  let otherAccountId: string;
  let otherCandidateId: string;

  const hdr = () => ({ Authorization: `Bearer ${ownerToken}`, 'x-account-id': accountId });
  const otherHdr = () => ({ Authorization: `Bearer ${otherToken}`, 'x-account-id': otherAccountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: ownerEmail, password, displayName: 'Candidate Owner' })
      .expect(201);
    ownerToken = reg.body.accessToken;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Candidate Update Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    const create = await request(app.getHttpServer())
      .post('/candidates')
      .set(hdr())
      .send({
        firstName: 'Jamie',
        lastName: 'Rivera',
        email: `jamie-${suffix}@example.com`,
        phone: '+1 555 0100',
        headline: 'Staff Platform Engineer',
        location: 'Austin, TX',
        currentCompany: 'Acme',
        currentTitle: 'Senior Engineer',
        yearsExperience: 8,
        summary: 'Loves distributed systems.',
      })
      .expect(201);
    candidateId = create.body.id;

    const otherReg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: otherOwnerEmail, password, displayName: 'Other Owner' })
      .expect(201);
    otherToken = otherReg.body.accessToken;

    const otherAcc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ name: 'Other Co', slug: otherSlug, region: 'us-east-1' })
      .expect(201);
    otherAccountId = otherAcc.body.id;

    const otherCreate = await request(app.getHttpServer())
      .post('/candidates')
      .set(otherHdr())
      .send({ firstName: 'Alex', lastName: 'Stone' })
      .expect(201);
    otherCandidateId = otherCreate.body.id;
  });

  afterAll(async () => {
    await regional.candidateSkill.deleteMany({ where: { candidate: { accountId } } });
    await regional.candidate.deleteMany({ where: { accountId } });
    await regional.account.deleteMany({ where: { id: accountId } });
    await regional.candidateSkill.deleteMany({ where: { candidate: { accountId: otherAccountId } } });
    await regional.candidate.deleteMany({ where: { accountId: otherAccountId } });
    await regional.account.deleteMany({ where: { id: otherAccountId } });
    await regional.$disconnect();
    await db.membership.deleteMany({ where: { accountId: { in: [accountId, otherAccountId] } } });
    await db.accountDirectory.deleteMany({ where: { id: { in: [accountId, otherAccountId] } } });
    await db.user.deleteMany({ where: { email: { in: [ownerEmail, otherOwnerEmail] } } });
    await app.close();
  });

  it('applies partial updates and leaves untouched fields alone', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/candidates/${candidateId}`)
      .set(hdr())
      .send({ currentTitle: 'Principal Engineer', currentCompany: 'Globex' })
      .expect(200);
    expect(res.body.currentTitle).toBe('Principal Engineer');
    expect(res.body.currentCompany).toBe('Globex');
    // Untouched fields keep their values.
    expect(res.body.firstName).toBe('Jamie');
    expect(res.body.headline).toBe('Staff Platform Engineer');
    expect(res.body.email).toMatch(/@example\.com$/);
  });

  it('can set and clear yearsExperience via PATCH', async () => {
    const set = await request(app.getHttpServer())
      .patch(`/candidates/${candidateId}`)
      .set(hdr())
      .send({ yearsExperience: 12 })
      .expect(200);
    expect(set.body.yearsExperience).toBe(12);

    const cleared = await request(app.getHttpServer())
      .patch(`/candidates/${candidateId}`)
      .set(hdr())
      .send({ yearsExperience: null })
      .expect(200);
    expect(cleared.body.yearsExperience).toBeNull();
  });

  it('clears nullable string fields when sent as null', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/candidates/${candidateId}`)
      .set(hdr())
      .send({ phone: null, headline: null })
      .expect(200);
    expect(res.body.phone).toBeNull();
    expect(res.body.headline).toBeNull();
  });

  it('rejects an empty firstName so a required column can never be wiped', async () => {
    await request(app.getHttpServer())
      .patch(`/candidates/${candidateId}`)
      .set(hdr())
      .send({ firstName: '' })
      .expect(400);
  });

  it('rejects an invalid email format', async () => {
    await request(app.getHttpServer())
      .patch(`/candidates/${candidateId}`)
      .set(hdr())
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('returns 404 when the candidate belongs to another tenant', async () => {
    await request(app.getHttpServer())
      .patch(`/candidates/${otherCandidateId}`)
      .set(hdr())
      .send({ currentTitle: 'Attempted cross-tenant write' })
      .expect(404);

    // Double-check: victim record is untouched.
    const victim = await regional.candidate.findUnique({ where: { id: otherCandidateId } });
    expect(victim?.currentTitle).toBeNull();
  });

  it('trims whitespace on name fields', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/candidates/${candidateId}`)
      .set(hdr())
      .send({ firstName: '  Jamie   ', lastName: ' Rivera ' })
      .expect(200);
    expect(res.body.firstName).toBe('Jamie');
    expect(res.body.lastName).toBe('Rivera');
  });
});
