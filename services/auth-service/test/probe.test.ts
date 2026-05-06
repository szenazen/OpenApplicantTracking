import { JwtModule, JwtService } from '@nestjs/jwt';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthSliceController } from '../src/slice/auth-slice.controller';
import { MonolithLoginShimService } from '../src/slice/monolith-login-shim.service';

describe('AuthSliceController', () => {
  async function compile(): Promise<{ mod: TestingModule; c: AuthSliceController }> {
    const mod = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'unit-test-secret-min-32-characters-xx', signOptions: { expiresIn: '15m' } }),
      ],
      controllers: [AuthSliceController],
      providers: [
        {
          provide: MonolithLoginShimService,
          useValue: {
            isShimEnabled: () => false,
            forwardLogin: jest.fn(async () => ({ status: 200, body: {} })),
          },
        },
      ],
    }).compile();
    return { mod, c: mod.get(AuthSliceController) };
  }

  it('probe', async () => {
    const { c } = await compile();
    expect(c.probe()).toMatchObject({ _service: 'auth-service' });
  });

  it('verifyAccess rejects invalid JWT', async () => {
    const { c } = await compile();
    const garbage =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.not-a-real-signature-xxxxxxxxxxxxxxxx';
    expect(c.verifyAccess({ accessToken: garbage })).toEqual({
      valid: false,
      _service: 'auth-service',
    });
  });

  it('loginSlice returns 503 when shim disabled', async () => {
    const { c } = await compile();
    await expect(c.loginSlice({ email: 'a@example.com', password: 'password1' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('loginSlice forwards monolith status via HttpException when shim enabled', async () => {
    const mod = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'unit-test-secret-min-32-characters-xx', signOptions: { expiresIn: '15m' } }),
      ],
      controllers: [AuthSliceController],
      providers: [
        {
          provide: MonolithLoginShimService,
          useValue: {
            isShimEnabled: () => true,
            forwardLogin: jest.fn(async () => ({
              status: 401,
              body: { message: 'Invalid credentials' },
            })),
          },
        },
      ],
    }).compile();
    const c = mod.get(AuthSliceController);
    try {
      await c.loginSlice({ email: 'a@example.com', password: 'password1' });
      throw new Error('expected HttpException');
    } catch (e) {
      if (e instanceof Error && e.message === 'expected HttpException') throw e;
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(401);
      expect((e as HttpException).getResponse()).toEqual({ message: 'Invalid credentials' });
    }
  });

  it('verifyAccess returns payload for JWT signed by this module', async () => {
    const { mod, c } = await compile();
    const jwt = mod.get(JwtService);
    const token = await jwt.signAsync({ sub: 'usr-42', email: 'u@test.local' });
    const r = c.verifyAccess({ accessToken: token });
    expect(r).toMatchObject({
      valid: true,
      payload: { sub: 'usr-42', email: 'u@test.local' },
      _service: 'auth-service',
    });
  });
});
