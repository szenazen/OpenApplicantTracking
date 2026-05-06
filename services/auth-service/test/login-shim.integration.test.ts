import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';

describe('POST /api/slice/auth/login (monolith shim)', () => {
  const secret = 'test-auth-login-shim-integration-secret-xxxxxx';

  let app: INestApplication;
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    process.env.AUTH_LOGIN_SHIM = '1';
    process.env.MONOLITH_URL = 'http://127.0.0.1:59999';
  });

  beforeAll(async () => {
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
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  it('proxies JSON from MONOLITH_URL /api/auth/login', async () => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresIn: '15m' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const res = await request(app.getHttpServer())
      .post('/api/slice/auth/login')
      .send({ email: 'u@test.local', password: 'password-here-min-1-char' })
      .expect(200);
    expect(res.body).toEqual({ accessToken: 'a', refreshToken: 'r', expiresIn: '15m' });
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:59999/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: expect.any(Object),
        body: JSON.stringify({ email: 'u@test.local', password: 'password-here-min-1-char' }),
      }),
    );
  });
});
