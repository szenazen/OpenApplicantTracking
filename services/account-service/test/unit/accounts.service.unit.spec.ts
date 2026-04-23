import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountsService } from '../../src/accounts/accounts.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('AccountsService (unit)', () => {
  let svc: AccountsService;
  const mockDb = {
    membership: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    role: { findMany: jest.fn(), findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [AccountsService, { provide: PrismaService, useValue: mockDb }],
    }).compile();
    svc = moduleRef.get(AccountsService);
  });

  describe('getForUser', () => {
    it('returns account payload with _service marker', async () => {
      mockDb.membership.findUnique.mockResolvedValue({
        account: { id: 'a1', name: 'Co', slug: 'co', region: 'US_EAST_1' },
        role: { name: 'admin' },
      });
      await expect(svc.getForUser('u1', 'a1')).resolves.toEqual({
        id: 'a1',
        name: 'Co',
        slug: 'co',
        region: 'us-east-1',
        role: 'admin',
        _service: 'account-service',
      });
    });

    it('throws when not a member', async () => {
      mockDb.membership.findUnique.mockResolvedValue(null);
      await expect(svc.getForUser('u1', 'a1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('assignableInviteRoles', () => {
    it('excludes admin for account_manager', async () => {
      mockDb.role.findMany.mockResolvedValue([
        { id: '1', name: 'account_manager', description: null },
        { id: '2', name: 'recruiter', description: null },
      ]);
      const out = await svc.assignableInviteRoles('account_manager');
      expect(mockDb.role.findMany).toHaveBeenCalledWith({
        where: {
          name: { in: ['viewer', 'hiring_manager', 'recruiter', 'account_manager'] },
          scope: 'ACCOUNT',
        },
        select: { id: true, name: true, description: true },
        orderBy: { name: 'asc' },
      });
      expect(out.roles).toHaveLength(2);
    });

    it('includes admin for admin actor', async () => {
      mockDb.role.findMany.mockResolvedValue([{ id: 'a', name: 'admin', description: null }]);
      await svc.assignableInviteRoles('admin');
      expect(mockDb.role.findMany).toHaveBeenCalledWith({
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
      mockDb.user.findUnique.mockResolvedValue(null);
      await expect(svc.addMemberByEmail('acc', 'admin', 'x@y.com', 'viewer')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws when role invalid', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockDb.role.findUnique.mockResolvedValue(null);
      await expect(svc.addMemberByEmail('acc', 'admin', 'x@y.com', 'viewer')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws when already active member', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockDb.role.findUnique.mockResolvedValue({ id: 'r1', scope: 'ACCOUNT' });
      mockDb.membership.findUnique.mockResolvedValue({ status: 'ACTIVE' });
      await expect(svc.addMemberByEmail('acc', 'admin', 'x@y.com', 'viewer')).rejects.toThrow(
        ConflictException,
      );
    });

    it('reactivates revoked membership via update', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockDb.role.findUnique.mockResolvedValue({ id: 'r1', scope: 'ACCOUNT' });
      mockDb.membership.findUnique.mockResolvedValue({ status: 'REVOKED' });
      mockDb.membership.update.mockResolvedValue({});

      await expect(svc.addMemberByEmail('acc', 'admin', 'x@y.com', 'viewer')).resolves.toEqual({
        ok: true,
        userId: 'u1',
        role: 'viewer',
      });
      expect(mockDb.membership.create).not.toHaveBeenCalled();
      expect(mockDb.membership.update).toHaveBeenCalled();
    });

    it('creates new membership when none exists', async () => {
      mockDb.user.findUnique.mockResolvedValue({ id: 'u1' });
      mockDb.role.findUnique.mockResolvedValue({ id: 'r1', scope: 'ACCOUNT' });
      mockDb.membership.findUnique.mockResolvedValue(null);
      mockDb.membership.create.mockResolvedValue({});

      await expect(svc.addMemberByEmail('acc', 'admin', 'x@y.com', 'viewer')).resolves.toEqual({
        ok: true,
        userId: 'u1',
        role: 'viewer',
      });
      expect(mockDb.membership.create).toHaveBeenCalled();
    });
  });

  describe('listMembers', () => {
    it('maps rows to API shape', async () => {
      mockDb.membership.findMany.mockResolvedValue([
        {
          user: { id: 'u1', displayName: 'A', email: 'a@b.com', avatarUrl: null },
          role: { name: 'admin' },
          status: 'ACTIVE',
        },
      ]);
      await expect(svc.listMembers('acc1')).resolves.toEqual([
        {
          userId: 'u1',
          displayName: 'A',
          email: 'a@b.com',
          avatarUrl: null,
          role: 'admin',
          status: 'ACTIVE',
        },
      ]);
    });
  });
});
