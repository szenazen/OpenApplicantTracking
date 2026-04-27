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

describe('JobDomainService.list', () => {
  const db = {
    job: { findMany: jest.fn() },
    application: { groupBy: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('maps rows and candidate counts', async () => {
    const createdAt = new Date('2020-01-01T00:00:00Z');
    db.job.findMany.mockResolvedValue([
      {
        id: 'j1',
        accountId: 'acc',
        title: 'Eng',
        status: 'PUBLISHED',
        pipelineId: 'p1',
        headCount: 2,
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
      },
    ]);
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
      candidateCounts: { total: 5, active: 3 },
      pipeline: { id: 'p1', name: 'Default', isDefault: true },
    });
    expect(r.nextCursor).toBe(null);
  });
});
