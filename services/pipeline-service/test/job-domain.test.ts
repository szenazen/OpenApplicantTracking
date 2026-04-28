import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountServiceClient } from '../src/integrations/account-service.client';
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
    ownerId: string | null;
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
  const accounts = { resolveMemberProfiles: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    accounts.resolveMemberProfiles.mockResolvedValue(new Map());
  });

  it('maps rows and candidate counts', async () => {
    db.job.findMany.mockResolvedValue([jobRow({ department: 'Sales' })]);
    db.application.groupBy
      .mockResolvedValueOnce([{ jobId: 'j1', _count: { _all: 5 } }])
      .mockResolvedValueOnce([{ jobId: 'j1', _count: { _all: 3 } }]);

    const m = await Test.createTestingModule({
      providers: [
        JobDomainService,
        { provide: PrismaService, useValue: db },
        { provide: AccountServiceClient, useValue: accounts },
      ],
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

  it('resolves owner via account-service when Authorization present', async () => {
    db.job.findMany.mockResolvedValue([jobRow({ ownerId: 'u1' })]);
    db.application.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const profMap = new Map([
      [
        'u1',
        { id: 'u1', displayName: 'Pat', email: 'p@x.com', avatarUrl: 'http://a' },
      ],
    ]);
    accounts.resolveMemberProfiles.mockResolvedValue(profMap);

    const m = await Test.createTestingModule({
      providers: [
        JobDomainService,
        { provide: PrismaService, useValue: db },
        { provide: AccountServiceClient, useValue: accounts },
      ],
    }).compile();
    const svc = m.get(JobDomainService);
    const r = await svc.list('acc', {}, { authorization: 'Bearer t' });

    expect(accounts.resolveMemberProfiles).toHaveBeenCalledWith('acc', ['u1'], 'Bearer t');
    expect(r.items[0]?.owner).toEqual({
      id: 'u1',
      displayName: 'Pat',
      email: 'p@x.com',
      avatarUrl: 'http://a',
    });
  });

  it('passes monolith-style OR search for q (title, department, location, client)', async () => {
    db.job.findMany.mockResolvedValue([]);
    db.application.groupBy.mockResolvedValue([]);

    const m = await Test.createTestingModule({
      providers: [
        JobDomainService,
        { provide: PrismaService, useValue: db },
        { provide: AccountServiceClient, useValue: accounts },
      ],
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

describe('JobDomainService.get', () => {
  const db = { job: { findFirst: jest.fn() } };
  const accounts = { resolveMemberProfiles: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    accounts.resolveMemberProfiles.mockResolvedValue(new Map());
  });

  it('throws NotFound when job missing', async () => {
    db.job.findFirst.mockResolvedValue(null);
    const m = await Test.createTestingModule({
      providers: [
        JobDomainService,
        { provide: PrismaService, useValue: db },
        { provide: AccountServiceClient, useValue: accounts },
      ],
    }).compile();
    await expect(m.get(JobDomainService).get('acc', 'missing')).rejects.toThrow(NotFoundException);
  });

  it('returns applications with candidate cards', async () => {
    const createdAt = new Date('2021-01-01T00:00:00Z');
    db.job.findFirst.mockResolvedValue({
      id: 'j1',
      accountId: 'acc',
      title: 'Role',
      description: null,
      department: null,
      location: null,
      clientName: null,
      headCount: 1,
      employmentType: 'FULL_TIME',
      status: 'PUBLISHED',
      pipelineId: 'p1',
      requiredSkillIds: [],
      ownerId: null,
      openedAt: null,
      closedAt: null,
      createdAt,
      updatedAt: createdAt,
      pipeline: {
        id: 'p1',
        name: 'Pipe',
        isDefault: false,
        statuses: [{ id: 's1', name: 'New', position: 0, category: 'NEW', color: null }],
      },
      applications: [
        {
          id: 'a1',
          candidateId: 'c1',
          jobId: 'j1',
          currentStatusId: 's1',
          position: 0,
          version: 1,
          appliedAt: createdAt,
          lastTransitionAt: createdAt,
          candidate: {
            id: 'c1',
            firstName: 'Sam',
            lastName: 'Lee',
            headline: 'Dev',
            email: 's@e.com',
            currentTitle: 'Eng',
            currentCompany: 'Co',
            yearsExperience: 5,
            location: 'NYC',
          },
          currentStatus: { id: 's1' },
        },
      ],
    });

    const m = await Test.createTestingModule({
      providers: [
        JobDomainService,
        { provide: PrismaService, useValue: db },
        { provide: AccountServiceClient, useValue: accounts },
      ],
    }).compile();
    const r = await m.get(JobDomainService).get('acc', 'j1');

    expect(r.applications).toHaveLength(1);
    expect(r.applications[0]).toMatchObject({
      id: 'a1',
      candidateId: 'c1',
      commentCount: 0,
      candidate: { firstName: 'Sam', lastName: 'Lee' },
    });
    expect(r.members).toEqual([]);
    expect(r.requiredSkills).toEqual([]);
  });
});
