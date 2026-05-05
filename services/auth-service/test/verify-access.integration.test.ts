import { JwtService } from '@nestjs/jwt';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

describe('POST /api/slice/auth/verify-access (integration)', () => {
  const secret = 'test-auth-verify-access-secret-xx';

  let app: INestApplication;
  let jwt: JwtService;

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns valid with sub/email for a JWT signed by the same secret', async () => {
    const token = await jwt.signAsync({ sub: 'user-id-1', email: 'a@example.com' });
    const res = await request(app.getHttpServer())
      .post('/api/slice/auth/verify-access')
      .send({ accessToken: token })
      .expect(200);
    expect(res.body).toMatchObject({
      valid: true,
      _service: 'auth-service',
      payload: { sub: 'user-id-1', email: 'a@example.com' },
    });
  });

  it('returns valid false for bad token without throwing HTTP error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/slice/auth/verify-access')
      .send({ accessToken: 'not.a.real.jwt.token.xxx' })
      .expect(200);
    expect(res.body).toEqual({ valid: false, _service: 'auth-service' });
  });

  it('returns 400 for missing accessToken field', async () => {
    await request(app.getHttpServer()).post('/api/slice/auth/verify-access').send({}).expect(400);
  });
});
