import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly router: RegionRouterService,
    private readonly realtime: RealtimeGateway,
    private readonly global: GlobalPrismaService,
  ) {}

  /**
   * Load a single application together with enough context to render the
   * candidate drawer on the Kanban page:
   *   - candidate (full record)
   *   - job (title/department/location)
   *   - current status
   *   - transition history, ordered chronologically, enriched with
   *       • fromStatusName / toStatusName  (looked up in the same pipeline)
   *       • byUserDisplayName              (resolved from the global user table)
   *
   * Matches the APPLICATION_STATUS_HISTORY entity in design/ATS-design.drawio.xml
   * (from_status_id, to_status_id, changed_by_user_id, changed_at).
   */
  async get(accountId: string, applicationId: string) {
    const { client } = await this.router.forAccount(accountId);
    const application = await client.application.findFirst({
      where: { id: applicationId, accountId },
      include: {
        candidate: true,
        job: { select: { id: true, title: true, department: true, location: true, pipelineId: true } },
        currentStatus: true,
        transitions: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!application) throw new NotFoundException('Application not found');

    // Resolve status id → name for from/to using the job's pipeline.
    const statusIds = new Set<string>();
    for (const t of application.transitions) {
      if (t.fromStatusId) statusIds.add(t.fromStatusId);
      statusIds.add(t.toStatusId);
    }
    const statuses = statusIds.size
      ? await client.pipelineStatus.findMany({
          where: { id: { in: Array.from(statusIds) } },
          select: { id: true, name: true, category: true, color: true },
        })
      : [];
    const statusById = new Map(statuses.map((s) => [s.id, s] as const));

    // Resolve actor user ids → display name from the global user table.
    const userIds = Array.from(new Set(application.transitions.map((t) => t.byUserId))).filter(Boolean);
    const users = userIds.length
      ? await this.global.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true, email: true, avatarUrl: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u] as const));

    const transitions = application.transitions.map((t) => ({
      id: t.id,
      createdAt: t.createdAt,
      reason: t.reason,
      fromStatusId: t.fromStatusId,
      toStatusId: t.toStatusId,
      fromStatusName: t.fromStatusId ? statusById.get(t.fromStatusId)?.name ?? null : null,
      toStatusName: statusById.get(t.toStatusId)?.name ?? null,
      byUserId: t.byUserId,
      byUserDisplayName: userById.get(t.byUserId)?.displayName ?? null,
      byUserAvatarUrl: userById.get(t.byUserId)?.avatarUrl ?? null,
    }));

    return {
      id: application.id,
      candidateId: application.candidateId,
      jobId: application.jobId,
      currentStatusId: application.currentStatusId,
      position: application.position,
      version: application.version,
      appliedAt: application.appliedAt,
      lastTransitionAt: application.lastTransitionAt,
      notes: application.notes,
      candidate: application.candidate,
      job: application.job,
      currentStatus: application.currentStatus,
      transitions,
    };
  }

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
   *
   * Reliability guarantees (per design/ATS-design.drawio.xml):
   *   - **Optimistic concurrency**: if the caller sends `expectedVersion` and
   *     it no longer matches the DB row, we reject with 409 so the client
   *     can reconcile before retrying. This protects against two recruiters
   *     dragging the same card simultaneously from stale state.
   *   - **Idempotency**: if `idempotencyKey` is supplied (typically the
   *     browser's per-drag uuid) and a transition with the same key already
   *     exists for this application, we return the current state as a
   *     no-op — safe to retry on network errors without creating duplicates.
   */
  async move(
    accountId: string,
    applicationId: string,
    input: {
      toStatusId: string;
      toPosition: number;
      reason?: string;
      expectedVersion?: number;
    },
    actorUserId: string,
    idempotencyKey?: string,
  ) {
    const { client } = await this.router.forAccount(accountId);

    return client.$transaction(async (tx) => {
      // Idempotent replay: if this exact retry already landed, surface the
      // post-state without doing anything else.
      if (idempotencyKey) {
        const prior = await tx.applicationTransition.findUnique({
          where: {
            applicationId_idempotencyKey: { applicationId, idempotencyKey },
          },
        });
        if (prior) {
          const settled = await tx.application.findFirst({
            where: { id: applicationId, accountId },
            include: { candidate: true, currentStatus: true },
          });
          if (!settled) throw new NotFoundException('Application not found');
          return settled;
        }
      }

      const current = await tx.application.findFirst({
        where: { id: applicationId, accountId },
        include: { currentStatus: true, job: { include: { pipeline: true } } },
      });
      if (!current) throw new NotFoundException('Application not found');

      // Optimistic concurrency check. Only enforce if the caller actually
      // sent a version — unversioned clients are still accepted (the first
      // writer wins, which is the current default).
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== current.version
      ) {
        throw new ConflictException({
          message: 'Application version mismatch — reload to reconcile.',
          expectedVersion: input.expectedVersion,
          actualVersion: current.version,
        });
      }

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
        data: {
          currentStatusId: toStatusId,
          position: toPos,
          lastTransitionAt: new Date(),
          version: { increment: 1 },
        },
        include: { candidate: true, currentStatus: true },
      });

      await tx.applicationTransition.create({
        data: {
          applicationId,
          fromStatusId,
          toStatusId,
          byUserId: actorUserId,
          reason: input.reason,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'application.moved',
          resource: `application:${applicationId}`,
          metadata: { fromStatusId, toStatusId, toPosition: toPos, version: moved.version },
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
