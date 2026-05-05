import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthSliceController } from '../src/slice/auth-slice.controller';

describe('AuthSliceController', () => {
  async function compile(): Promise<{ mod: TestingModule; c: AuthSliceController }> {
    const mod = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'unit-test-secret-min-32-characters-xx', signOptions: { expiresIn: '15m' } }),
      ],
      controllers: [AuthSliceController],
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
