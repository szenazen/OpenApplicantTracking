import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvitationsService } from '../../src/invitations/invitations.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('InvitationsService (unit)', () => {
  let svc: InvitationsService;
  const mockDb = {
    invitation: {
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    role: { findUnique: jest.fn() },
    membership: { findFirst: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [InvitationsService, { provide: PrismaService, useValue: mockDb }],
    }).compile();
    svc = moduleRef.get(InvitationsService);
  });

  it('create: account_manager cannot assign admin', async () => {
    await expect(
      svc.create('acc', 'inv', 'account_manager', 'a@b.com', 'admin'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('create: rejects invalid role', async () => {
    mockDb.role.findUnique.mockResolvedValue(null);
    await expect(svc.create('acc', 'inv', 'admin', 'a@b.com', 'nope')).rejects.toThrow(BadRequestException);
  });

  it('create: rejects SYSTEM scope role', async () => {
    mockDb.role.findUnique.mockResolvedValue({ id: 'r1', scope: 'SYSTEM' });
    await expect(svc.create('acc', 'inv', 'admin', 'a@b.com', 'admin')).rejects.toThrow(BadRequestException);
  });

  it('create: rejects when email is already active member', async () => {
    mockDb.role.findUnique.mockResolvedValue({ id: 'r1', scope: 'ACCOUNT' });
    mockDb.membership.findFirst.mockResolvedValue({ id: 'm1' });
    await expect(svc.create('acc', 'inv', 'admin', 'a@b.com', 'viewer')).rejects.toThrow(ConflictException);
  });

  it('create: normalizes email and returns token payload shape', async () => {
    mockDb.role.findUnique.mockResolvedValue({ id: 'r1', scope: 'ACCOUNT' });
    mockDb.membership.findFirst.mockResolvedValue(null);
    mockDb.invitation.create.mockResolvedValue({
      id: 'i1',
      email: 'a@b.com',
      expiresAt: new Date('2030-01-01'),
      token: 'tok',
    });
    const out = await svc.create('acc', 'inv', 'admin', '  A@B.COM  ', 'viewer');
    expect(out).toEqual({
      id: 'i1',
      email: 'a@b.com',
      expiresAt: new Date('2030-01-01'),
      token: 'tok',
    });
    expect(mockDb.invitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountId: 'acc',
          email: 'a@b.com',
          roleId: 'r1',
          inviterId: 'inv',
        }),
      }),
    );
  });

  it('revoke: throws when no row updated', async () => {
    mockDb.invitation.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.revoke('acc', 'inv1')).rejects.toThrow(NotFoundException);
  });

  it('revoke: returns ok when row updated', async () => {
    mockDb.invitation.updateMany.mockResolvedValue({ count: 1 });
    await expect(svc.revoke('acc', 'inv1')).resolves.toEqual({ ok: true });
  });

  it('listPending: maps rows', async () => {
    const exp = new Date('2030-01-01');
    const cre = new Date('2020-01-01');
    mockDb.invitation.findMany.mockResolvedValue([
      { id: 'i1', email: 'x@y.com', expiresAt: exp, createdAt: cre, role: { name: 'viewer' } },
    ]);
    await expect(svc.listPending('acc')).resolves.toEqual([
      { id: 'i1', email: 'x@y.com', role: 'viewer', expiresAt: exp, createdAt: cre },
    ]);
  });
});
