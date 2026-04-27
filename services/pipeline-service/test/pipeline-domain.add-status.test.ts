import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainEventsService } from '../src/domain-events/domain-events.service';
import { PipelineDomainService } from '../src/pipelines/pipeline-domain.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PipelineDomainService.addStatus', () => {
  let svc: PipelineDomainService;
  const events = { emit: jest.fn() };
  const db = {
    pipeline: { findFirst: jest.fn() },
    pipelineStatus: {
      aggregate: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const m = await Test.createTestingModule({
      providers: [
        PipelineDomainService,
        { provide: PrismaService, useValue: db },
        { provide: DomainEventsService, useValue: events },
      ],
    }).compile();
    svc = m.get(PipelineDomainService);
  });

  it('throws when pipeline missing', async () => {
    db.pipeline.findFirst.mockResolvedValue(null);
    await expect(svc.addStatus('acc', 'pid', { name: 'S' })).rejects.toThrow(NotFoundException);
  });

  it('appends status at end when position omitted', async () => {
    db.pipeline.findFirst.mockResolvedValue({ id: 'pid' });
    db.pipelineStatus.aggregate.mockResolvedValue({ _max: { position: 2 } });
    const st = { id: 'st1', name: 'Review', pipelineId: 'pid' };
    db.pipelineStatus.create.mockResolvedValue(st);
    await expect(svc.addStatus('acc', 'pid', { name: 'Review' })).resolves.toEqual(st);
    expect(db.pipelineStatus.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ position: 3, name: 'Review' }),
      }),
    );
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PipelineStatusAdded',
        payload: { statusId: 'st1', name: 'Review' },
      }),
    );
  });
});
