import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '.prisma/regional';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';
import { ReactionsService } from '../reactions/reactions.service';
import { JobMembersService } from '../job-members/job-members.service';

export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'TEMPORARY';
export type JobStatus = 'DRAFT' | 'PUBLISHED' | 'ON_HOLD' | 'CLOSED' | 'ARCHIVED';

export interface CreateJobInput {
  title: string;
  description?: string;
  department?: string;
  location?: string;
  employmentType?: EmploymentType;
  pipelineId?: string;
  requiredSkillIds?: string[];
}

/**
 * Partial update payload. Every field is optional; `undefined` means
 * "don't touch", `null` means "clear it out" (for nullable string fields).
 * Status transitions stamp `openedAt` / `closedAt` automatically so we
 * don't rely on callers getting that right.
 */
export interface UpdateJobInput {
  title?: string;
  description?: string | null;
  department?: string | null;
  location?: string | null;
  employmentType?: EmploymentType;
  status?: JobStatus;
  requiredSkillIds?: string[];
  pipelineId?: string;
}

@Injectable()
export class JobsService {
  constructor(
    private readonly router: RegionRouterService,
    private readonly reactions: ReactionsService,
    private readonly members: JobMembersService,
  ) {}

  async list(accountId: string) {
    const { client } = await this.router.forAccount(accountId);
    return client.job.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      include: { pipeline: { include: { statuses: { orderBy: { position: 'asc' } } } } },
    });
  }

  /**
   * Full job payload with all applications, each enriched with:
   *   - `commentCount` — number of non-deleted HR/hiring-manager comments
   *   - `reactionSummary` — counts per kind + the requester's own reactions
   * so the Kanban can render comment + reaction badges without extra RTTs.
   */
  async get(accountId: string, jobId: string, requesterUserId: string) {
    const { client } = await this.router.forAccount(accountId);
    const job = await client.job.findFirst({
      where: { id: jobId, accountId },
      include: {
        pipeline: { include: { statuses: { orderBy: { position: 'asc' } } } },
        applications: {
          include: { candidate: true, currentStatus: true },
          orderBy: [{ currentStatusId: 'asc' }, { position: 'asc' }],
        },
      },
    });
    if (!job) throw new NotFoundException('Job not found');

    const appIds = job.applications.map((a) => a.id);
    const [commentCounts, reactionByApp, members] = await Promise.all([
      appIds.length
        ? client.applicationComment.groupBy({
            by: ['applicationId'],
            where: { accountId, applicationId: { in: appIds }, deletedAt: null },
            _count: { _all: true },
          })
        : Promise.resolve([] as Array<{ applicationId: string; _count: { _all: number } }>),
      this.reactions.summarizeMany(accountId, appIds, requesterUserId),
      this.members.listForJob(accountId, jobId),
    ]);
    const commentCountByApp = new Map(commentCounts.map((c) => [c.applicationId, c._count._all] as const));

    const applications = job.applications.map((a) => ({
      ...a,
      commentCount: commentCountByApp.get(a.id) ?? 0,
      reactionSummary: reactionByApp.get(a.id) ?? { counts: { THUMBS_UP: 0, THUMBS_DOWN: 0, STAR: 0 }, myReactions: [] },
    }));

    // Resolve requiredSkillIds -> names so the UI doesn't display raw CUIDs.
    const requiredSkills = job.requiredSkillIds.length
      ? await client.skillCache.findMany({
          where: { id: { in: job.requiredSkillIds } },
          select: { id: true, name: true },
        })
      : [];

    return { ...job, applications, members, requiredSkills };
  }

  /**
   * Partial update of a job.
   *
   * Responsibilities:
   *   - validates the target exists and belongs to the account,
   *   - applies only fields the caller explicitly sent,
   *   - enforces status-transition side effects (stamp `openedAt` when a
   *     draft first gets PUBLISHED, stamp `closedAt` when we transition to
   *     a terminal status),
   *   - validates `pipelineId` belongs to the same account when changed,
   *   - emits a `job.updated` AuditEvent with the set of changed fields
   *     so the Activities tab surfaces the edit (metadata carries the
   *     before/after for string fields so we can render diffs later).
   */
  async update(
    accountId: string,
    jobId: string,
    input: UpdateJobInput,
    actorUserId: string,
  ) {
    const { client } = await this.router.forAccount(accountId);
    const current = await client.job.findFirst({ where: { id: jobId, accountId } });
    if (!current) throw new NotFoundException('Job not found');

    if (input.pipelineId && input.pipelineId !== current.pipelineId) {
      const pipe = await client.pipeline.findFirst({
        where: { id: input.pipelineId, accountId },
        select: { id: true },
      });
      if (!pipe) throw new BadRequestException('Pipeline not found for this account');
    }

    const data: Prisma.JobUpdateInput = {};
    const changedFields: string[] = [];
    const diff: Record<string, { from: unknown; to: unknown }> = {};

    function setIfChanged<K extends keyof UpdateJobInput>(
      key: K,
      prismaKey: keyof Prisma.JobUpdateInput = key as keyof Prisma.JobUpdateInput,
    ) {
      if (input[key] === undefined) return;
      const before = (current as any)[key];
      const after = input[key];
      if (before === after) return;
      (data as any)[prismaKey] = after;
      changedFields.push(key as string);
      diff[key as string] = { from: before ?? null, to: after ?? null };
    }

    setIfChanged('title');
    setIfChanged('description');
    setIfChanged('department');
    setIfChanged('location');
    setIfChanged('employmentType');
    setIfChanged('pipelineId');

    if (input.requiredSkillIds !== undefined) {
      const before = current.requiredSkillIds;
      const after = input.requiredSkillIds;
      if (!sameSet(before, after)) {
        data.requiredSkillIds = { set: after };
        changedFields.push('requiredSkillIds');
        diff.requiredSkillIds = { from: before, to: after };
      }
    }

    if (input.status !== undefined && input.status !== current.status) {
      data.status = input.status;
      changedFields.push('status');
      diff.status = { from: current.status, to: input.status };
      // Transition side-effects.
      if (input.status === 'PUBLISHED' && !current.openedAt) {
        data.openedAt = new Date();
      }
      if ((input.status === 'CLOSED' || input.status === 'ARCHIVED') && !current.closedAt) {
        data.closedAt = new Date();
      }
      if (input.status === 'PUBLISHED' && current.closedAt) {
        // Re-opening — clear closedAt so Reports don't treat it as closed.
        data.closedAt = null;
      }
    }

    if (changedFields.length === 0) {
      return current;
    }

    const updated = await client.$transaction(async (tx) => {
      const u = await tx.job.update({ where: { id: jobId }, data });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'job.updated',
          resource: `job:${jobId}`,
          metadata: {
            jobId,
            changedFields,
            diff,
          } as Prisma.InputJsonValue,
        },
      });
      return u;
    });
    return updated;
  }

  async create(accountId: string, input: CreateJobInput) {
    const { client } = await this.router.forAccount(accountId);
    let pipelineId = input.pipelineId;
    if (!pipelineId) {
      const defaultPipeline = await client.pipeline.findFirst({
        where: { accountId, isDefault: true },
      });
      if (!defaultPipeline) throw new BadRequestException('No default pipeline and no pipelineId provided');
      pipelineId = defaultPipeline.id;
    }
    return client.job.create({
      data: {
        accountId,
        title: input.title,
        description: input.description,
        department: input.department,
        location: input.location,
        employmentType: input.employmentType ?? 'FULL_TIME',
        pipelineId,
        requiredSkillIds: input.requiredSkillIds ?? [],
        status: 'PUBLISHED',
        openedAt: new Date(),
      },
    });
  }
}

/** Shallow set-equality for string[] fields. Order-insensitive. */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}
