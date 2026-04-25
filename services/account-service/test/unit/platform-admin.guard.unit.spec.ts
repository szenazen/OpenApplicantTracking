import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PlatformAdminGuard } from '../../src/platform/platform-admin.guard';

function makeCtx(userId: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: userId ? { userId } : {} }),
    }),
  } as ExecutionContext;
}

describe('PlatformAdminGuard (unit)', () => {
  it('throws Unauthorized when no user id', async () => {
    const db = { user: { findUnique: jest.fn() } };
    const guard = new PlatformAdminGuard(db as any);
    await expect(guard.canActivate(makeCtx(undefined))).rejects.toThrow(UnauthorizedException);
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('throws Forbidden when platformAdmin is false', async () => {
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ platformAdmin: false }) } };
    const guard = new PlatformAdminGuard(db as any);
    await expect(guard.canActivate(makeCtx('u1'))).rejects.toThrow(ForbiddenException);
  });

  it('returns true when platformAdmin is true', async () => {
    const db = { user: { findUnique: jest.fn().mockResolvedValue({ platformAdmin: true }) } };
    const guard = new PlatformAdminGuard(db as any);
    await expect(guard.canActivate(makeCtx('u1'))).resolves.toBe(true);
  });
});
