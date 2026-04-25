import { Test } from '@nestjs/testing';
import { PlatformService } from '../../src/platform/platform.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('PlatformService (unit)', () => {
  let svc: PlatformService;
  const mockDb = {
    accountDirectory: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [PlatformService, { provide: PrismaService, useValue: mockDb }],
    }).compile();
    svc = moduleRef.get(PlatformService);
  });

  it('listAccounts maps region enum to slug', async () => {
    mockDb.accountDirectory.findMany.mockResolvedValue([
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
});
