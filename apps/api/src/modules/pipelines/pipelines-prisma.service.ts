import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

@Injectable()
export class PipelinesPrismaService {
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

  async create(
    accountId: string,
    name: string,
    statuses: { name: string; color?: string; category?: string }[],
  ) {
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
            category: (s.category as never) ?? 'IN_PROGRESS',
          })),
        },
      },
      include: { statuses: { orderBy: { position: 'asc' } } },
    });
  }

  async addStatus(
    accountId: string,
    pipelineId: string,
    input: { name: string; color?: string; category?: string; position?: number },
  ) {
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
        category: (input.category as never) ?? 'IN_PROGRESS',
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

  /**
   * Removes a stage when no applications still reference it (move cards first).
   */
  async removeStatus(accountId: string, pipelineId: string, statusId: string) {
    const { client } = await this.router.forAccount(accountId);
    const status = await client.pipelineStatus.findFirst({
      where: {
        id: statusId,
        pipelineId,
        pipeline: { id: pipelineId, accountId },
      },
    });
    if (!status) throw new NotFoundException('Pipeline status not found');

    const inUse = await client.application.count({ where: { currentStatusId: statusId } });
    if (inUse > 0) {
      throw new BadRequestException(
        `This stage still has ${inUse} application(s). Move them to another stage before removing it.`,
      );
    }

    await client.pipelineStatus.delete({ where: { id: statusId } });
    return this.get(accountId, pipelineId);
  }
}
