import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PlatformService } from '../../src/modules/platform/platform.service';
import { GlobalPrismaService } from '../../src/infrastructure/prisma/global-prisma.service';
import { AccountsService } from '../../src/modules/accounts/accounts.service';

describe('PlatformService (unit)', () => {
  let svc: PlatformService;
  const mockGlobal = {
    accountDirectory: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const mockAccounts = {
    create: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformService,
        { provide: GlobalPrismaService, useValue: mockGlobal },
        { provide: AccountsService, useValue: mockAccounts },
      ],
    }).compile();
    svc = moduleRef.get(PlatformService);
  });

  it('listAccounts maps region enum to slug', async () => {
    mockGlobal.accountDirectory.findMany.mockResolvedValue([
      {
        id: '1',
        name: 'A',
        slug: 'a',
        region: 'US_EAST_1',
        status: 'ACTIVE',
        ownerUserId: 'o1',
        createdAt: new Date(),
      },
    ]);
    const rows = await svc.listAccounts();
    expect(rows[0]!.region).toBe('us-east-1');
  });

  it('createAccount resolves ownerEmail to user id', async () => {
    const owner = { id: 'owner1' };
    mockGlobal.user.findUnique.mockResolvedValueOnce(owner).mockResolvedValueOnce(owner);
    mockAccounts.create.mockResolvedValue({ id: 'acc1', slug: 's', region: 'us-east-1' });

    await expect(
      svc.createAccount({
        name: 'N',
        slug: 's',
        region: 'us-east-1',
        ownerEmail: '  O@X.COM  ',
      }),
    ).resolves.toEqual({ id: 'acc1', slug: 's', region: 'us-east-1' });

    expect(mockGlobal.user.findUnique).toHaveBeenCalledWith({ where: { email: 'o@x.com' } });
    expect(mockAccounts.create).toHaveBeenCalledWith({
      ownerUserId: 'owner1',
      name: 'N',
      slug: 's',
      region: 'us-east-1',
    });
  });

  it('createAccount uses ownerUserId when no email', async () => {
    mockGlobal.user.findUnique.mockResolvedValueOnce({ id: 'owner1' });
    mockAccounts.create.mockResolvedValue({});

    await svc.createAccount({
      name: 'N',
      slug: 's',
      region: 'us-east-1',
      ownerUserId: 'owner1',
    });
    expect(mockAccounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: 'owner1' }),
    );
  });

  it('createAccount throws when owner email not found', async () => {
    mockGlobal.user.findUnique.mockResolvedValue(null);
    await expect(
      svc.createAccount({ name: 'N', slug: 's', region: 'us-east-1', ownerEmail: 'x@y.com' }),
    ).rejects.toThrow(NotFoundException);
    expect(mockAccounts.create).not.toHaveBeenCalled();
  });

  it('createAccount throws BadRequest when neither owner id nor email', async () => {
    await expect(svc.createAccount({ name: 'N', slug: 's', region: 'us-east-1' })).rejects.toThrow(
      BadRequestException,
    );
  });
});
