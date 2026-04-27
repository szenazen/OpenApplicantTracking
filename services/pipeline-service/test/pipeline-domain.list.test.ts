import { Test } from '@nestjs/testing';
import { DomainEventsService } from '../src/domain-events/domain-events.service';
import { PipelineDomainService } from '../src/pipelines/pipeline-domain.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('PipelineDomainService.list', () => {
  let svc: PipelineDomainService;
  const db = {
    pipeline: {
      findMany: jest.fn(),
    },
  };

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

  it('returns findMany result', async () => {
    const rows = [{ id: 'p1', accountId: 'acc', name: 'A', statuses: [] }];
    db.pipeline.findMany.mockResolvedValue(rows);
    await expect(svc.list('acc')).resolves.toEqual(rows);
    expect(db.pipeline.findMany).toHaveBeenCalledWith({
      where: { accountId: 'acc' },
      include: { statuses: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  });
});
