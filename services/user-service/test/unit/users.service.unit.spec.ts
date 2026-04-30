import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UsersService } from '../../src/users/users.service';

describe('UsersService (unit)', () => {
  let svc: UsersService;
  const mockDb = {
    user: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: mockDb }],
    }).compile();
    svc = moduleRef.get(UsersService);
  });

  it('returns profile payload with service marker', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    mockDb.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'demo@test.local',
      displayName: 'Demo User',
      avatarUrl: null,
      locale: 'en',
      platformAdmin: false,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });

    await expect(svc.getMe('u1')).resolves.toEqual({
      id: 'u1',
      email: 'demo@test.local',
      displayName: 'Demo User',
      avatarUrl: null,
      locale: 'en',
      platformAdmin: false,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      _service: 'user-service',
    });
  });

  it('throws NotFoundException when user does not exist', async () => {
    mockDb.user.findUnique.mockResolvedValue(null);
    await expect(svc.getMe('missing')).rejects.toThrow(NotFoundException);
  });
});
