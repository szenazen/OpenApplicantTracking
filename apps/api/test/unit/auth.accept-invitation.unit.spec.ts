import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../../src/modules/auth/auth.service';

describe('AuthService.acceptInvitation (unit)', () => {
  const mockDb = {
    invitation: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    membership: { upsert: jest.fn() },
  };

  let svc: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new AuthService(mockDb as any, {} as JwtService, {} as ConfigService);
  });

  it('rejects invalid token / expired / revoked / accepted', async () => {
    mockDb.invitation.findUnique.mockResolvedValue(null);
    await expect(svc.acceptInvitation('u1', 'a@b.com', 't')).rejects.toThrow(BadRequestException);

    const past = new Date(Date.now() - 60_000);
    mockDb.invitation.findUnique.mockResolvedValue({
      id: 'i1',
      email: 'a@b.com',
      accountId: 'acc',
      roleId: 'r1',
      revokedAt: new Date(),
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      role: { name: 'viewer' },
    });
    await expect(svc.acceptInvitation('u1', 'a@b.com', 't')).rejects.toThrow(BadRequestException);

    mockDb.invitation.findUnique.mockResolvedValue({
      id: 'i1',
      email: 'a@b.com',
      accountId: 'acc',
      roleId: 'r1',
      revokedAt: null,
      acceptedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      role: { name: 'viewer' },
    });
    await expect(svc.acceptInvitation('u1', 'a@b.com', 't')).rejects.toThrow(BadRequestException);

    mockDb.invitation.findUnique.mockResolvedValue({
      id: 'i1',
      email: 'a@b.com',
      accountId: 'acc',
      roleId: 'r1',
      revokedAt: null,
      acceptedAt: null,
      expiresAt: past,
      role: { name: 'viewer' },
    });
    await expect(svc.acceptInvitation('u1', 'a@b.com', 't')).rejects.toThrow(BadRequestException);
  });

  it('rejects when session email does not match invitation', async () => {
    mockDb.invitation.findUnique.mockResolvedValue({
      id: 'i1',
      email: 'invited@x.com',
      accountId: 'acc',
      roleId: 'r1',
      revokedAt: null,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      role: { name: 'viewer' },
    });
    await expect(svc.acceptInvitation('u1', 'other@x.com', 't')).rejects.toThrow(ForbiddenException);
  });

  it('upserts membership and marks invitation accepted', async () => {
    mockDb.invitation.findUnique.mockResolvedValue({
      id: 'i1',
      email: 'a@b.com',
      accountId: 'acc',
      roleId: 'r1',
      revokedAt: null,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      role: { name: 'viewer' },
    });
    mockDb.membership.upsert.mockResolvedValue({});
    mockDb.invitation.update.mockResolvedValue({});

    await expect(svc.acceptInvitation('u1', 'A@B.COM', 'tok')).resolves.toEqual({ ok: true, accountId: 'acc' });

    expect(mockDb.membership.upsert).toHaveBeenCalledWith({
      where: { userId_accountId: { userId: 'u1', accountId: 'acc' } },
      update: { status: 'ACTIVE', roleId: 'r1' },
      create: { userId: 'u1', accountId: 'acc', roleId: 'r1', status: 'ACTIVE' },
    });
    expect(mockDb.invitation.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { acceptedAt: expect.any(Date) },
    });
  });
});
