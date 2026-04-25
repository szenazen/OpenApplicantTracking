import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PipelinesPrismaService } from '../../src/modules/pipelines/pipelines-prisma.service';
import { RegionRouterService } from '../../src/infrastructure/region-router/region-router.service';

describe('PipelinesPrismaService.removeStatus (unit)', () => {
  let svc: PipelinesPrismaService;
  const client = {
    pipelineStatus: {
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
    application: { count: jest.fn() },
    pipeline: {
      findFirst: jest.fn(),
    },
  };

  const router = {
    forAccount: jest.fn().mockResolvedValue({ client }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [PipelinesPrismaService, { provide: RegionRouterService, useValue: router }],
    }).compile();
    svc = moduleRef.get(PipelinesPrismaService);
  });

  it('throws NotFound when status missing', async () => {
    client.pipelineStatus.findFirst.mockResolvedValue(null);
    await expect(svc.removeStatus('acc', 'pipe', 'st')).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequest when applications reference status', async () => {
    client.pipelineStatus.findFirst.mockResolvedValue({ id: 'st' });
    client.application.count.mockResolvedValue(2);
    await expect(svc.removeStatus('acc', 'pipe', 'st')).rejects.toThrow(BadRequestException);
    expect(client.pipelineStatus.delete).not.toHaveBeenCalled();
  });

  it('deletes and returns pipeline snapshot from get()', async () => {
    client.pipelineStatus.findFirst.mockResolvedValue({ id: 'st' });
    client.application.count.mockResolvedValue(0);
    client.pipelineStatus.delete.mockResolvedValue({});
    const snapshot = { id: 'pipe', accountId: 'acc', name: 'P', statuses: [] };
    client.pipeline.findFirst.mockResolvedValue(snapshot);

    await expect(svc.removeStatus('acc', 'pipe', 'st')).resolves.toEqual(snapshot);
    expect(client.pipelineStatus.delete).toHaveBeenCalledWith({ where: { id: 'st' } });
    expect(client.pipeline.findFirst).toHaveBeenCalledWith({
      where: { id: 'pipe', accountId: 'acc' },
      include: { statuses: { orderBy: { position: 'asc' } } },
    });
  });
});
