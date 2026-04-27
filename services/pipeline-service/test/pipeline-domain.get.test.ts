import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainEventsService } from '../src/domain-events/domain-events.service';
import { PipelineDomainService } from '../src/pipelines/pipeline-domain.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PipelineDomainService.get', () => {
  let svc: PipelineDomainService;
  const db = { pipeline: { findFirst: jest.fn() } };

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        PipelineDomainService,
        { provide: PrismaService, useValue: db },
        { provide: DomainEventsService, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    svc = m.get(PipelineDomainService);
  });

  it('throws when missing', async () => {
    db.pipeline.findFirst.mockResolvedValue(null);
    await expect(svc.get('acc', 'p')).rejects.toThrow(NotFoundException);
  });

  it('returns pipeline', async () => {
    const p = { id: 'p', accountId: 'acc', name: 'X', statuses: [] };
    db.pipeline.findFirst.mockResolvedValue(p);
    await expect(svc.get('acc', 'p')).resolves.toEqual(p);
  });
});
