import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../domain-events/domain-events.service';
import { mapStatusCategory } from './map-status-category';

@Injectable()
export class PipelineDomainService {
  constructor(
    private readonly db: PrismaService,
    private readonly events: DomainEventsService,
  ) {}

  async list(accountId: string) {
    return this.db.pipeline.findMany({
      where: { accountId },
      include: { statuses: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(accountId: string, pipelineId: string) {
    const p = await this.db.pipeline.findFirst({
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
    const created = await this.db.pipeline.create({
      data: {
        accountId,
        name,
        statuses: {
          create: statuses.map((s, i) => ({
            name: s.name,
            position: i,
            color: s.color,
            category: mapStatusCategory(s.category),
          })),
        },
      },
      include: { statuses: { orderBy: { position: 'asc' } } },
    });
    void this.events.emit({
      type: 'PipelineCreated',
      accountId,
      pipelineId: created.id,
      payload: { name, statusCount: created.statuses.length },
    });
    return created;
  }

  async addStatus(
    accountId: string,
    pipelineId: string,
    input: { name: string; color?: string; category?: string; position?: number },
  ) {
    const pipeline = await this.db.pipeline.findFirst({ where: { id: pipelineId, accountId } });
    if (!pipeline) throw new NotFoundException('Pipeline not found');
    const max = await this.db.pipelineStatus.aggregate({
      where: { pipelineId },
      _max: { position: true },
    });
    const position = input.position ?? (max._max.position ?? -1) + 1;
    const st = await this.db.pipelineStatus.create({
      data: {
        pipelineId,
        name: input.name,
        color: input.color,
        category: mapStatusCategory(input.category),
        position,
      },
    });
    void this.events.emit({
      type: 'PipelineStatusAdded',
      accountId,
      pipelineId,
      payload: { statusId: st.id, name: st.name },
    });
    return st;
  }

  async reorderStatuses(accountId: string, pipelineId: string, orderedStatusIds: string[]) {
    await this.get(accountId, pipelineId);
    await this.db.$transaction(
      orderedStatusIds.map((id, index) =>
        this.db.pipelineStatus.update({ where: { id }, data: { position: index } }),
      ),
    );
    const full = await this.get(accountId, pipelineId);
    void this.events.emit({
      type: 'PipelineStatusesReordered',
      accountId,
      pipelineId,
    });
    return full;
  }

  async removeStatus(accountId: string, pipelineId: string, statusId: string) {
    const status = await this.db.pipelineStatus.findFirst({
      where: {
        id: statusId,
        pipelineId,
        pipeline: { id: pipelineId, accountId },
      },
    });
    if (!status) throw new NotFoundException('Pipeline status not found');
    const inUse = await this.db.application.count({ where: { currentStatusId: statusId } });
    if (inUse > 0) {
      throw new BadRequestException(
        `This stage still has ${inUse} application(s). Move them before removing the stage.`,
      );
    }
    await this.db.pipelineStatus.delete({ where: { id: statusId } });
    const full = await this.get(accountId, pipelineId);
    void this.events.emit({
      type: 'PipelineStatusRemoved',
      accountId,
      pipelineId,
      payload: { statusId },
    });
    return full;
  }
}
