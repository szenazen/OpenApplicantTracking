import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AccountAdminOrManagerGuard } from '../../src/common/account-admin-or-manager.guard';

function makeCtx(role: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ctx: role !== undefined ? { role } : {} }),
    }),
  } as ExecutionContext;
}

describe('AccountAdminOrManagerGuard (unit)', () => {
  const guard = new AccountAdminOrManagerGuard();

  it('allows admin', () => {
    expect(guard.canActivate(makeCtx('admin'))).toBe(true);
  });

  it('allows account_manager', () => {
    expect(guard.canActivate(makeCtx('account_manager'))).toBe(true);
  });

  it('forbids recruiter', () => {
    expect(() => guard.canActivate(makeCtx('recruiter'))).toThrow(ForbiddenException);
  });

  it('forbids missing role', () => {
    expect(() => guard.canActivate(makeCtx(undefined as unknown as string))).toThrow(ForbiddenException);
  });
});
