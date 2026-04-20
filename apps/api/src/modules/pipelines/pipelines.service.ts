import { Injectable, NotFoundException } from '@nestjs/common';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

@Injectable()
export class PipelinesService {
  constructor(private readonly router: RegionRouterService) {}

  async list(accountId: string) {
    const { client } = await this.router.forAccount(accountId);
    return client.pipeline.findMany({
      where: { accountId },
      include: { statuses: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(accountId: string, pipelineId: string) {
    const { client } = await this.router.forAccount(accountId);
    const p = await client.pipeline.findFirst({
      where: { id: pipelineId, accountId },
      include: { statuses: { orderBy: { position: 'asc' } } },
    });
    if (!p) throw new NotFoundException('Pipeline not found');
    return p;
  }

  async create(accountId: string, name: string, statuses: { name: string; color?: string; category?: string }[]) {
    const { client } = await this.router.forAccount(accountId);
    return client.pipeline.create({
      data: {
        accountId,
        name,
        statuses: {
          create: statuses.map((s, i) => ({
            name: s.name,
            position: i,
            color: s.color,
            category: (s.category as any) ?? 'IN_PROGRESS',
          })),
        },
      },
      include: { statuses: { orderBy: { position: 'asc' } } },
    });
  }

  async addStatus(accountId: string, pipelineId: string, input: { name: string; color?: string; category?: string; position?: number }) {
    const { client } = await this.router.forAccount(accountId);
    const pipeline = await client.pipeline.findFirst({ where: { id: pipelineId, accountId } });
    if (!pipeline) throw new NotFoundException('Pipeline not found');

    const max = await client.pipelineStatus.aggregate({
      where: { pipelineId },
      _max: { position: true },
    });
    const position = input.position ?? (max._max.position ?? -1) + 1;

    return client.pipelineStatus.create({
      data: {
        pipelineId,
        name: input.name,
        color: input.color,
        category: (input.category as any) ?? 'IN_PROGRESS',
        position,
      },
    });
  }

  async reorderStatuses(accountId: string, pipelineId: string, orderedStatusIds: string[]) {
    const { client } = await this.router.forAccount(accountId);
    await client.$transaction(
      orderedStatusIds.map((id, index) =>
        client.pipelineStatus.update({ where: { id }, data: { position: index } }),
      ),
    );
    return this.get(accountId, pipelineId);
  }
}
