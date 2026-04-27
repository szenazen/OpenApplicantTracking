import { Test } from '@nestjs/testing';
import { DomainEventsService } from '../src/domain-events/domain-events.service';
import { PipelineDomainService } from '../src/pipelines/pipeline-domain.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PipelineDomainService.reorderStatuses', () => {
  let svc: PipelineDomainService;
  const events = { emit: jest.fn() };
  const snap = { id: 'pid', accountId: 'acc', name: 'P', statuses: [] };

  const db = {
    pipeline: { findFirst: jest.fn() },
    pipelineStatus: { update: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    db.pipeline.findFirst.mockResolvedValue(snap);
    const m = await Test.createTestingModule({
      providers: [
        PipelineDomainService,
        { provide: PrismaService, useValue: db },
        { provide: DomainEventsService, useValue: events },
      ],
    }).compile();
    svc = m.get(PipelineDomainService);
  });

  it('runs transaction with position updates and returns pipeline', async () => {
    const ordered = ['s2', 's1'];
    await expect(svc.reorderStatuses('acc', 'pid', ordered)).resolves.toEqual(snap);
    expect(db.$transaction).toHaveBeenCalled();
    expect(db.pipelineStatus.update).toHaveBeenCalledTimes(2);
    expect(db.pipelineStatus.update).toHaveBeenNthCalledWith(1, {
      where: { id: 's2' },
      data: { position: 0 },
    });
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'PipelineStatusesReordered', pipelineId: 'pid' }),
    );
  });
});
