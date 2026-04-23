import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import { AppModule } from '../src/app.module';
import { GlobalPrismaService } from '../src/infrastructure/prisma/global-prisma.service';
import { uniqueSuffix } from './helpers/test-module';

/**
 * Phase 10 — job-scoped roles: observers cannot edit the requisition or
 * manage the team; recruiters/owners can.
 */
describe('Job permissions (integration)', () => {
  let app: INestApplication;
  let db: GlobalPrismaService;
  let regional: RegionalPrisma;
  const suffix = uniqueSuffix();
  const recruiterEmail = `perm-rec-${suffix}@test.local`;
  const observerEmail = `perm-obs-${suffix}@test.local`;
  const password = 'correct-horse-battery-staple';
  const slug = `perm-${suffix}`;

  let recruiterToken: string;
  let observerToken: string;
  let accountId: string;
  let jobId: string;
  let recruiterUserId: string;
  let observerUserId: string;

  const hdrRec = () => ({ Authorization: `Bearer ${recruiterToken}`, 'x-account-id': accountId });
  const hdrObs = () => ({ Authorization: `Bearer ${observerToken}`, 'x-account-id': accountId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = moduleRef.get(GlobalPrismaService);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: recruiterEmail, password, displayName: 'Perm Recruiter' })
      .expect(201);
    recruiterToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: recruiterEmail, password }).expect(200)
    ).body.accessToken;
    recruiterUserId = (await db.user.findUnique({ where: { email: recruiterEmail } }))!.id;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: observerEmail, password, displayName: 'Perm Observer' })
      .expect(201);
    observerToken = (
      await request(app.getHttpServer()).post('/auth/login').send({ email: observerEmail, password }).expect(200)
    ).body.accessToken;
    observerUserId = (await db.user.findUnique({ where: { email: observerEmail } }))!.id;

    const acc = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${recruiterToken}`)
      .send({ name: 'Perm Co', slug, region: 'us-east-1' })
      .expect(201);
    accountId = acc.body.id;

    // Account *recruiter* — not admin — so job-scoped OBSERVER rules apply
    // (admins bypass job role checks). Role may not exist until seed; upsert for CI.
    const recruiterRole = await db.role.upsert({
      where: { name: 'recruiter' },
      update: {},
      create: {
        name: 'recruiter',
        scope: 'ACCOUNT',
        isSystem: true,
        description: 'Manage candidates and applications',
      },
    });
    await db.membership.create({
      data: { userId: observerUserId, accountId, roleId: recruiterRole.id, status: 'ACTIVE' },
    });

    regional = new RegionalPrisma({
      datasources: { db: { url: process.env.REGION_US_EAST_1_DATABASE_URL! } },
    });

    const pipelineRes = await request(app.getHttpServer())
      .post('/pipelines')
      .set(hdrRec())
      .send({ name: 'Perm Pipe', statuses: [{ name: 'New', category: 'NEW' }] })
      .expect(201);

    const job = await request(app.getHttpServer())
      .post('/jobs')
      .set(hdrRec())
      .send({ title: 'Perm Job', pipelineId: pipelineRes.body.id })
      .expect(201);
    jobId = job.body.id;

    await request(app.getHttpServer())
      .post(`/jobs/${jobId}/members`)
      .set(hdrRec())
      .send({ userId: observerUserId, role: 'OBSERVER' })
      .expect(201);
  });

  afterAll(async () => {
    await regional.jobMember.deleteMany({ where: { accountId } });
    await regional.job.deleteMany({ where: { accountId } });
    await regional.pipelineStatus.deleteMany({ where: { pipeline: { accountId } } });
    await regional.pipeline.deleteMany({ where: { accountId } });
    await regional.auditEvent.deleteMany({ where: { accountId } });
    await regional.account.deleteMany({ where: { id: accountId } });
    await regional.$disconnect();
    await db.membership.deleteMany({ where: { accountId } });
    await db.accountDirectory.deleteMany({ where: { id: accountId } });
    await db.user.deleteMany({ where: { email: { in: [recruiterEmail, observerEmail] } } });
    await app.close();
  });

  it('forbids OBSERVER from PATCHing the job', async () => {
    await request(app.getHttpServer())
      .patch(`/jobs/${jobId}`)
      .set(hdrObs())
      .send({ title: 'Hacked' })
      .expect(403);
  });

  it('forbids OBSERVER from adding a team member', async () => {
    await request(app.getHttpServer())
      .post(`/jobs/${jobId}/members`)
      .set(hdrObs())
      .send({ userId: recruiterUserId, role: 'RECRUITER' })
      .expect(403);
  });

  it('allows RECRUITER (owner) to PATCH the job', async () => {
    await request(app.getHttpServer())
      .patch(`/jobs/${jobId}`)
      .set(hdrRec())
      .send({ department: 'Legal' })
      .expect(200);
  });
});
