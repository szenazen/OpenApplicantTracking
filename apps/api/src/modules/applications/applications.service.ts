import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly router: RegionRouterService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Create a candidate↔job application. Places at bottom of the pipeline's first status (category = NEW). */
  async apply(accountId: string, input: { candidateId: string; jobId: string; statusId?: string }, actorUserId: string) {
    const { client } = await this.router.forAccount(accountId);
    const job = await client.job.findFirst({
      where: { id: input.jobId, accountId },
      include: { pipeline: { include: { statuses: { orderBy: { position: 'asc' } } } } },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (!job.pipeline.statuses.length) throw new BadRequestException('Pipeline has no statuses');

    const statusId =
      input.statusId ??
      job.pipeline.statuses.find((s) => s.category === 'NEW')?.id ??
      job.pipeline.statuses[0]!.id;

    // Next position = last + 1 in this status column
    const last = await client.application.aggregate({
      where: { jobId: job.id, currentStatusId: statusId },
      _max: { position: true },
    });
    const position = (last._max.position ?? -1) + 1;

    const app = await client.$transaction(async (tx) => {
      const created = await tx.application.create({
        data: {
          accountId,
          candidateId: input.candidateId,
          jobId: job.id,
          currentStatusId: statusId,
          position,
        },
        include: { candidate: true, currentStatus: true },
      });
      await tx.applicationTransition.create({
        data: { applicationId: created.id, fromStatusId: null, toStatusId: statusId, byUserId: actorUserId },
      });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'application.created',
          resource: `application:${created.id}`,
          metadata: { jobId: job.id, candidateId: input.candidateId },
        },
      });
      return created;
    });

    this.realtime.emitApplicationChange(accountId, job.id, { type: 'created', application: app });
    return app;
  }

  /**
   * Move an application across columns (or reorder within one).
   * Atomically updates position and emits a realtime event.
   */
  async move(
    accountId: string,
    applicationId: string,
    input: { toStatusId: string; toPosition: number; reason?: string },
    actorUserId: string,
  ) {
    const { client } = await this.router.forAccount(accountId);

    return client.$transaction(async (tx) => {
      const current = await tx.application.findFirst({
        where: { id: applicationId, accountId },
        include: { currentStatus: true, job: { include: { pipeline: true } } },
      });
      if (!current) throw new NotFoundException('Application not found');

      const toStatus = await tx.pipelineStatus.findFirst({
        where: { id: input.toStatusId, pipelineId: current.job.pipelineId },
      });
      if (!toStatus) throw new BadRequestException('Target status not in this job\'s pipeline');

      const fromStatusId = current.currentStatusId;
      const fromPos = current.position;
      const toStatusId = input.toStatusId;
      const toPos = Math.max(0, input.toPosition);

      // Compact positions in both columns. We use gap-shifting (simple and correct).
      if (fromStatusId === toStatusId) {
        if (fromPos === toPos) return current;
        if (toPos > fromPos) {
          await tx.application.updateMany({
            where: { jobId: current.jobId, currentStatusId: fromStatusId, position: { gt: fromPos, lte: toPos } },
            data: { position: { decrement: 1 } },
          });
        } else {
          await tx.application.updateMany({
            where: { jobId: current.jobId, currentStatusId: fromStatusId, position: { gte: toPos, lt: fromPos } },
            data: { position: { increment: 1 } },
          });
        }
      } else {
        // Close the gap in the source column
        await tx.application.updateMany({
          where: { jobId: current.jobId, currentStatusId: fromStatusId, position: { gt: fromPos } },
          data: { position: { decrement: 1 } },
        });
        // Open space in the target column
        await tx.application.updateMany({
          where: { jobId: current.jobId, currentStatusId: toStatusId, position: { gte: toPos } },
          data: { position: { increment: 1 } },
        });
      }

      const moved = await tx.application.update({
        where: { id: applicationId },
        data: { currentStatusId: toStatusId, position: toPos, lastTransitionAt: new Date() },
        include: { candidate: true, currentStatus: true },
      });

      await tx.applicationTransition.create({
        data: {
          applicationId,
          fromStatusId,
          toStatusId,
          byUserId: actorUserId,
          reason: input.reason,
        },
      });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'application.moved',
          resource: `application:${applicationId}`,
          metadata: { fromStatusId, toStatusId, toPosition: toPos },
        },
      });

      this.realtime.emitApplicationChange(accountId, current.jobId, {
        type: 'moved',
        application: moved,
        fromStatusId,
        toStatusId,
        toPosition: toPos,
      });

      return moved;
    });
  }
}
