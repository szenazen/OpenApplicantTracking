import { Test } from '@nestjs/testing';
import { DomainEventsService } from '../src/domain-events/domain-events.service';
import { PipelineDomainService } from '../src/pipelines/pipeline-domain.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PipelineDomainService.create', () => {
  let svc: PipelineDomainService;
  const events = { emit: jest.fn() };
  const db = {
    pipeline: {
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

  it('creates pipeline, emits PipelineCreated', async () => {
    const created = {
      id: 'pid',
      accountId: 'acc',
      name: 'Hiring',
      statuses: [{ id: 's1', name: 'New' }],
    };
    db.pipeline.create.mockResolvedValue(created);
    await expect(
      svc.create('acc', 'Hiring', [{ name: 'Applied', category: 'NEW' }]),
    ).resolves.toEqual(created);
    expect(events.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PipelineCreated',
        accountId: 'acc',
        pipelineId: 'pid',
        payload: { name: 'Hiring', statusCount: 1 },
      }),
    );
  });
});
