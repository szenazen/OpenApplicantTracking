import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountContextGuard } from '../../src/common/account-context.guard';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('AccountContextGuard (unit)', () => {
  let guard: AccountContextGuard;
  let membershipFindUnique: jest.Mock;

  beforeEach(async () => {
    membershipFindUnique = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountContextGuard,
        { provide: PrismaService, useValue: { membership: { findUnique: membershipFindUnique } } },
      ],
    }).compile();
    guard = moduleRef.get(AccountContextGuard);
  });

  function execCtx(req: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as ExecutionContext;
  }

  it('throws Unauthorized when no user', async () => {
    const req = { headers: { 'x-account-id': 'a1' } };
    await expect(guard.canActivate(execCtx(req))).rejects.toThrow(UnauthorizedException);
  });

  it('throws Forbidden when header missing', async () => {
    const req = { user: { userId: 'u1', email: 'e@e.com', displayName: 'E' }, headers: {} };
    await expect(guard.canActivate(execCtx(req))).rejects.toThrow(ForbiddenException);
  });

  it('throws Forbidden when not a member', async () => {
    membershipFindUnique.mockResolvedValue(null);
    const req = {
      user: { userId: 'u1', email: 'e@e.com', displayName: 'E' },
      headers: { 'x-account-id': 'acc1' },
    };
    await expect(guard.canActivate(execCtx(req))).rejects.toThrow(ForbiddenException);
  });

  it('throws Forbidden when membership not ACTIVE', async () => {
    membershipFindUnique.mockResolvedValue({ status: 'REVOKED', role: { name: 'admin' } });
    const req = {
      user: { userId: 'u1', email: 'e@e.com', displayName: 'E' },
      headers: { 'x-account-id': 'acc1' },
    };
    await expect(guard.canActivate(execCtx(req))).rejects.toThrow(ForbiddenException);
  });

  it('sets ctx when membership is active', async () => {
    membershipFindUnique.mockResolvedValue({ status: 'ACTIVE', role: { name: 'recruiter' } });
    const req: Record<string, unknown> = {
      user: { userId: 'u1', email: 'e@e.com', displayName: 'E' },
      headers: { 'x-account-id': 'acc1' },
    };
    await expect(guard.canActivate(execCtx(req))).resolves.toBe(true);
    expect(req.ctx).toEqual({
      user: { userId: 'u1', email: 'e@e.com', displayName: 'E' },
      accountId: 'acc1',
      role: 'recruiter',
    });
  });

  it('accepts accountId from query string', async () => {
    membershipFindUnique.mockResolvedValue({ status: 'ACTIVE', role: { name: 'admin' } });
    const req: Record<string, unknown> = {
      user: { userId: 'u1', email: 'e@e.com', displayName: 'E' },
      headers: {},
      query: { accountId: 'from-query' },
    };
    await expect(guard.canActivate(execCtx(req))).resolves.toBe(true);
    expect((req.ctx as { accountId: string }).accountId).toBe('from-query');
  });
});
