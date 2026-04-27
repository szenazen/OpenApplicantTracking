import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DomainEventsService } from '../src/domain-events/domain-events.service';
import { PipelineDomainService } from '../src/pipelines/pipeline-domain.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PipelineDomainService.removeStatus', () => {
  let svc: PipelineDomainService;
  const events = { emit: jest.fn() };
  const db = {
    pipelineStatus: {
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
    application: { count: jest.fn() },
    pipeline: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
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

  it('throws NotFound when status missing', async () => {
    db.pipelineStatus.findFirst.mockResolvedValue(null);
    await expect(svc.removeStatus('acc', 'pipe', 'st')).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequest when applications reference status', async () => {
    db.pipelineStatus.findFirst.mockResolvedValue({ id: 'st' });
    db.application.count.mockResolvedValue(2);
    await expect(svc.removeStatus('acc', 'pipe', 'st')).rejects.toThrow(BadRequestException);
    expect(db.pipelineStatus.delete).not.toHaveBeenCalled();
  });

  it('deletes, emits, and returns pipeline from get()', async () => {
    db.pipelineStatus.findFirst.mockResolvedValue({ id: 'st' });
    db.application.count.mockResolvedValue(0);
    db.pipelineStatus.delete.mockResolvedValue({});
    const snap = { id: 'pipe', accountId: 'acc', name: 'P', statuses: [] };
    db.pipeline.findFirst.mockResolvedValue(snap);

    await expect(svc.removeStatus('acc', 'pipe', 'st')).resolves.toEqual(snap);
    expect(db.pipelineStatus.delete).toHaveBeenCalledWith({ where: { id: 'st' } });
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PipelineStatusRemoved',
        accountId: 'acc',
        pipelineId: 'pipe',
        payload: { statusId: 'st' },
      }),
    );
  });
});
