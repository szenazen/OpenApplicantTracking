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
  clientName?: string;
  headCount?: number;
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
  clientName?: string | null;
  headCount?: number;
  employmentType?: EmploymentType;
  status?: JobStatus;
  requiredSkillIds?: string[];
  pipelineId?: string;
}

/**
 * Filter / pagination query shape for `GET /jobs`. All fields are optional;
 * the list defaults to the first 50 PUBLISHED+DRAFT+ON_HOLD jobs, ordered
 * newest-first. Pagination is keyset on `(createdAt DESC, id DESC)` — same
 * approach as the candidates list — so new rows created mid-scroll don't
 * cause duplicate or skipped entries.
 */
export interface ListJobsQuery {
  q?: string;
  status?: JobStatus;
  includeArchived?: boolean;
  limit?: number;
  cursor?: string;
}

@Injectable()
export class JobsService {
  constructor(
    private readonly router: RegionRouterService,
    private readonly reactions: ReactionsService,
    private readonly members: JobMembersService,
  ) {}

  /**
   * Paginated + filtered job list for the `/dashboard/jobs` table view.
   *
   * Each item is enriched with:
   *   - `candidateCounts.{total, active}` — total applications and count
   *     of non-terminal ones (not HIRED / DROPPED), so the recruiter can
   *     scan pipeline health at a glance.
   *   - `pipeline` + `requiredSkills` — same shape the old flat `list`
   *     returned, so existing detail-page / Kanban callers keep working
   *     if they read a row from this list.
   *
   * `ARCHIVED` jobs are excluded by default — they're cold and would
   * dominate a paginated view. Pass `includeArchived=true` to include.
   */
  async list(accountId: string, query: ListJobsQuery = {}) {
    const { client } = await this.router.forAccount(accountId);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const q = query.q?.trim() ?? '';

    // Decode the keyset cursor — opaque from the client's perspective.
    let cursorCreatedAt: Date | undefined;
    let cursorId: string | undefined;
    if (query.cursor) {
      try {
        const raw = Buffer.from(query.cursor, 'base64url').toString('utf8');
        const [ts, id] = raw.split('_');
        if (ts && id) {
          const ms = Number(ts);
          if (Number.isFinite(ms)) {
            cursorCreatedAt = new Date(ms);
            cursorId = id;
          }
        }
      } catch {
        // Bad cursor → start from the beginning instead of erroring out.
      }
    }

    const where: Prisma.JobWhereInput = { accountId };
    const andClauses: Prisma.JobWhereInput[] = [];

    if (query.status) {
      where.status = query.status;
    } else if (!query.includeArchived) {
      where.status = { not: 'ARCHIVED' };
    }

    if (q) {
      andClauses.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { department: { contains: q, mode: 'insensitive' } },
          { location: { contains: q, mode: 'insensitive' } },
          { clientName: { contains: q, mode: 'insensitive' } },
        ],
      });
    }

    if (cursorCreatedAt && cursorId) {
      andClauses.push({
        OR: [
          { createdAt: { lt: cursorCreatedAt } },
          { createdAt: cursorCreatedAt, id: { lt: cursorId } },
        ],
      });
    }

    if (andClauses.length) where.AND = andClauses;

    // Fetch limit+1 to detect whether another page exists without a
    // separate COUNT query.
    const rows = await client.job.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        pipeline: { include: { statuses: { orderBy: { position: 'asc' } } } },
      },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    // Pull application counts in a single groupBy keyed by (jobId, category)
    // so we can derive both "total" and "active" (non-terminal) counts per
    // job without N+1 queries.
    const jobIds = page.map((j) => j.id);
    const counts = jobIds.length
      ? await client.application.groupBy({
          by: ['jobId'],
          where: { accountId, jobId: { in: jobIds } },
          _count: { _all: true },
        })
      : [];
    const activeCounts = jobIds.length
      ? await client.application.groupBy({
          by: ['jobId'],
          where: {
            accountId,
            jobId: { in: jobIds },
            currentStatus: { category: { notIn: ['HIRED', 'DROPPED'] } },
          },
          _count: { _all: true },
        })
      : [];
    const totalByJob = new Map(counts.map((c) => [c.jobId, c._count._all] as const));
    const activeByJob = new Map(activeCounts.map((c) => [c.jobId, c._count._all] as const));

    const items = page.map((j) => ({
      ...j,
      candidateCounts: {
        total: totalByJob.get(j.id) ?? 0,
        active: activeByJob.get(j.id) ?? 0,
      },
    }));

    const last = page.at(-1);
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${last.createdAt.getTime()}_${last.id}`, 'utf8').toString('base64url')
        : null;

    return { items, nextCursor };
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
    setIfChanged('clientName');
    setIfChanged('employmentType');
    setIfChanged('pipelineId');

    if (input.headCount !== undefined) {
      const next = Math.max(1, Math.round(Number(input.headCount)));
      if (Number.isFinite(next) && next !== current.headCount) {
        data.headCount = next;
        changedFields.push('headCount');
        diff.headCount = { from: current.headCount, to: next };
      }
    }

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
        clientName: input.clientName,
        // Coerce to a sane positive integer — the DB default is 1 when the
        // field is omitted so the column always has a value.
        headCount:
          input.headCount === undefined
            ? undefined
            : Math.max(1, Math.round(Number(input.headCount))),
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
