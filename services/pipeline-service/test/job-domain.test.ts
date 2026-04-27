import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JobDomainService } from '../src/jobs/job-domain.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('JobDomainService.parseListQuery', () => {
  it('rejects invalid status', () => {
    expect(() => JobDomainService.parseListQuery({ status: 'DONE' })).toThrow(BadRequestException);
  });

  it('parses valid query', () => {
    expect(JobDomainService.parseListQuery({ limit: '10', includeArchived: 'true' })).toEqual({
      status: undefined,
      q: undefined,
      includeArchived: true,
      limit: 10,
      cursor: undefined,
    });
  });
});

function jobRow(
  overrides: Partial<{
    id: string;
    title: string;
    description: string | null;
    department: string | null;
    pipeline: unknown;
    requiredSkillIds: string[];
  }> = {},
) {
  const createdAt = new Date('2020-01-01T00:00:00Z');
  return {
    id: 'j1',
    accountId: 'acc',
    title: 'Eng',
    description: null as string | null,
    department: null as string | null,
    location: null as string | null,
    clientName: null as string | null,
    headCount: 2,
    employmentType: 'FULL_TIME' as const,
    status: 'PUBLISHED' as const,
    pipelineId: 'p1',
    requiredSkillIds: [] as string[],
    ownerId: null as string | null,
    openedAt: null,
    closedAt: null,
    createdAt,
    updatedAt: createdAt,
    pipeline: {
      id: 'p1',
      name: 'Default',
      isDefault: true,
      statuses: [
        {
          id: 's1',
          name: 'New',
          position: 0,
          category: 'NEW',
          color: null,
        },
      ],
    },
    ...overrides,
  };
}

describe('JobDomainService.list', () => {
  const db = {
    job: { findMany: jest.fn() },
    application: { groupBy: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps rows and candidate counts', async () => {
    db.job.findMany.mockResolvedValue([jobRow({ department: 'Sales' })]);
    db.application.groupBy
      .mockResolvedValueOnce([{ jobId: 'j1', _count: { _all: 5 } }])
      .mockResolvedValueOnce([{ jobId: 'j1', _count: { _all: 3 } }]);

    const m = await Test.createTestingModule({
      providers: [JobDomainService, { provide: PrismaService, useValue: db }],
    }).compile();
    const svc = m.get(JobDomainService);
    const r = await svc.list('acc', { limit: 50 });

    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      id: 'j1',
      title: 'Eng',
      department: 'Sales',
      employmentType: 'FULL_TIME',
      requiredSkillIds: [],
      candidateCounts: { total: 5, active: 3 },
      pipeline: { id: 'p1', name: 'Default', isDefault: true },
    });
    expect(r.nextCursor).toBe(null);
  });

  it('passes monolith-style OR search for q (title, department, location, client)', async () => {
    db.job.findMany.mockResolvedValue([]);
    db.application.groupBy.mockResolvedValue([]);

    const m = await Test.createTestingModule({
      providers: [JobDomainService, { provide: PrismaService, useValue: db }],
    }).compile();
    const svc = m.get(JobDomainService);
    await svc.list('acc', { q: 'acme' });

    expect(db.job.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            {
              OR: [
                { title: { contains: 'acme', mode: 'insensitive' } },
                { department: { contains: 'acme', mode: 'insensitive' } },
                { location: { contains: 'acme', mode: 'insensitive' } },
                { clientName: { contains: 'acme', mode: 'insensitive' } },
              ],
            },
          ]),
        }),
      }),
    );
  });
});
