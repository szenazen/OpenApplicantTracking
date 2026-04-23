import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountsService } from '../../src/modules/accounts/accounts.service';
import { GlobalPrismaService } from '../../src/infrastructure/prisma/global-prisma.service';
import { RegionRouterService } from '../../src/infrastructure/region-router/region-router.service';

describe('AccountsService settings helpers (unit)', () => {
  let svc: AccountsService;
  const mockGlobal = {
    role: { findMany: jest.fn(), findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    membership: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountsService,
        { provide: GlobalPrismaService, useValue: mockGlobal },
        { provide: RegionRouterService, useValue: { forAccount: jest.fn() } },
      ],
    }).compile();
    svc = moduleRef.get(AccountsService);
  });

  describe('assignableInviteRoles', () => {
    it('excludes admin for account_manager', async () => {
      mockGlobal.role.findMany.mockResolvedValue([
        { id: '1', name: 'account_manager', description: null },
        { id: '2', name: 'recruiter', description: null },
      ]);
      const out = await svc.assignableInviteRoles('account_manager');
      expect(mockGlobal.role.findMany).toHaveBeenCalledWith({
        where: {
          name: { in: ['viewer', 'hiring_manager', 'recruiter', 'account_manager'] },
          scope: 'ACCOUNT',
        },
        select: { id: true, name: true, description: true },
        orderBy: { name: 'asc' },
      });
      expect(out.roles).toHaveLength(2);
    });

    it('includes admin for other roles (e.g. admin)', async () => {
      mockGlobal.role.findMany.mockResolvedValue([{ id: 'a', name: 'admin', description: null }]);
      await svc.assignableInviteRoles('admin');
      expect(mockGlobal.role.findMany).toHaveBeenCalledWith({
        where: {
          name: { in: ['viewer', 'hiring_manager', 'recruiter', 'account_manager', 'admin'] },
          scope: 'ACCOUNT',
        },
        select: { id: true, name: true, description: true },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('addMemberByEmail', () => {
    it('account_manager cannot assign admin', async () => {
      await expect(svc.addMemberByEmail('acc', 'account_manager', 'x@y.com', 'admin')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws when user not found', async () => {
      mockGlobal.user.findUnique.mockResolvedValue(null);
      await expect(svc.addMemberByEmail('acc', 'admin', 'x@y.com', 'viewer')).rejects.toThrow(NotFoundException);
    });

    it('throws when role invalid', async () => {
      mockGlobal.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockGlobal.role.findUnique.mockResolvedValue(null);
      await expect(svc.addMemberByEmail('acc', 'admin', 'x@y.com', 'viewer')).rejects.toThrow(BadRequestException);
    });

    it('throws when already active member', async () => {
      mockGlobal.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockGlobal.role.findUnique.mockResolvedValue({ id: 'r1', scope: 'ACCOUNT' });
      mockGlobal.membership.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      await expect(svc.addMemberByEmail('acc', 'admin', 'x@y.com', 'viewer')).rejects.toThrow(ConflictException);
    });

    it('reactivates revoked membership via update', async () => {
      mockGlobal.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockGlobal.role.findUnique.mockResolvedValue({ id: 'r1', scope: 'ACCOUNT' });
      mockGlobal.membership.findUnique.mockResolvedValue({ status: 'REVOKED' });
      mockGlobal.membership.update.mockResolvedValue({});

      await expect(svc.addMemberByEmail('acc', 'admin', 'x@y.com', 'viewer')).resolves.toEqual({
        ok: true,
        userId: 'u1',
        role: 'viewer',
      });
      expect(mockGlobal.membership.create).not.toHaveBeenCalled();
      expect(mockGlobal.membership.update).toHaveBeenCalled();
    });

    it('creates new membership when none exists', async () => {
      mockGlobal.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockGlobal.role.findUnique.mockResolvedValue({ id: 'r1', scope: 'ACCOUNT' });
      mockGlobal.membership.findUnique.mockResolvedValue(null);
      mockGlobal.membership.create.mockResolvedValue({});

      await expect(svc.addMemberByEmail('acc', 'admin', 'x@y.com', 'viewer')).resolves.toEqual({
        ok: true,
        userId: 'u1',
        role: 'viewer',
      });
      expect(mockGlobal.membership.create).toHaveBeenCalled();
    });
  });
});
