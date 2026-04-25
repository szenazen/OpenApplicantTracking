import { Test, TestingModule } from '@nestjs/testing';
import { AuthSliceController } from '../src/slice/auth-slice.controller';

describe('AuthSliceController', () => {
  it('probe', async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [AuthSliceController],
    }).compile();
    const c = mod.get(AuthSliceController);
    expect(c.probe()).toMatchObject({ _service: 'auth-service' });
  });
});
