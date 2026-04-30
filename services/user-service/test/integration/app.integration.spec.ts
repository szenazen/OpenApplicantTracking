import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaClient } from '../../src/generated/prisma';
import { uniqueSuffix } from '../helpers/unique-suffix';

describe('user-service HTTP (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let jwt: JwtService;

  const suffix = uniqueSuffix();
  const activeEmail = `us-active-${suffix}@test.local`;
  const suspendedEmail = `us-suspended-${suffix}@test.local`;
  let activeUserId: string;
  let suspendedUserId: string;
  let activeToken: string;
  let suspendedToken: string;

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

    const activeUser = await prisma.user.create({
      data: {
        email: activeEmail,
        displayName: 'US Active',
        status: 'ACTIVE',
      },
    });
    activeUserId = activeUser.id;

    const suspendedUser = await prisma.user.create({
      data: {
        email: suspendedEmail,
        displayName: 'US Suspended',
        status: 'SUSPENDED',
      },
    });
    suspendedUserId = suspendedUser.id;

    activeToken = jwt.sign({ sub: activeUserId, email: activeEmail });
    suspendedToken = jwt.sign({ sub: suspendedUserId, email: suspendedEmail });
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { email: { in: [activeEmail, suspendedEmail] } } });
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });

  it('GET /health', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.service).toBe('user-service');
  });

  it('GET /api/users/me returns caller profile', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${activeToken}`)
      .expect(200);

    expect(res.body.id).toBe(activeUserId);
    expect(res.body.email).toBe(activeEmail);
    expect(res.body.displayName).toBe('US Active');
    expect(res.body._service).toBe('user-service');
  });

  it('GET /api/users/me requires bearer token', async () => {
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
  });

  it('GET /api/users/me rejects suspended user token', async () => {
    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${suspendedToken}`)
      .expect(401);
  });
});
