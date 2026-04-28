import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/pipeline';
import { AccountServiceClient } from '../integrations/account-service.client';
import { PrismaService } from '../prisma/prisma.service';

const JOB_STATUSES = ['DRAFT', 'PUBLISHED', 'ON_HOLD', 'CLOSED', 'ARCHIVED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface ListJobsQuery {
  q?: string;
  status?: JobStatus;
  includeArchived?: boolean;
  limit?: number;
  cursor?: string;
}

export type JobRequestContext = { authorization?: string };

@Injectable()
export class JobDomainService {
  constructor(
    private readonly db: PrismaService,
    private readonly accounts: AccountServiceClient,
  ) {}

  /**
   * Paginated job list — shape aligned with `GET /api/jobs` on the monolith.
   * Owner chips resolved via account-service for active members only.
   */
  async list(accountId: string, query: ListJobsQuery = {}, ctx: JobRequestContext = {}) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    const q = query.q?.trim() ?? '';

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
        // Bad cursor → start from the beginning (monolith parity).
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

    const rows = await this.db.job.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        pipeline: { include: { statuses: { orderBy: { position: 'asc' } } } },
      },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const jobIds = page.map((j) => j.id);

    const counts = jobIds.length
      ? await this.db.application.groupBy({
          by: ['jobId'],
          where: { accountId, jobId: { in: jobIds } },
          _count: { _all: true },
        })
      : [];
    const activeCounts = jobIds.length
      ? await this.db.application.groupBy({
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

    const ownerIdList = [...new Set(page.map((j) => j.ownerId).filter((id): id is string => Boolean(id)))];
    const owners = await this.accounts.resolveMemberProfiles(accountId, ownerIdList, ctx.authorization);

    const items = page.map((j) => {
      const o = j.ownerId ? owners.get(j.ownerId) : undefined;
      return {
        id: j.id,
        title: j.title,
        description: j.description,
        department: j.department,
        location: j.location,
        clientName: j.clientName,
        headCount: j.headCount,
        employmentType: j.employmentType,
        status: j.status,
        pipelineId: j.pipelineId,
        requiredSkillIds: j.requiredSkillIds,
        openedAt: j.openedAt,
        closedAt: j.closedAt,
        createdAt: j.createdAt,
        owner: o
          ? { id: o.id, displayName: o.displayName, email: o.email, avatarUrl: o.avatarUrl ?? null }
          : null,
        ownerId: j.ownerId,
        candidateCounts: {
          total: totalByJob.get(j.id) ?? 0,
          active: activeByJob.get(j.id) ?? 0,
        },
        pipeline: {
          id: j.pipeline.id,
          name: j.pipeline.name,
          isDefault: j.pipeline.isDefault,
          statuses: j.pipeline.statuses.map((s) => ({
            id: s.id,
            name: s.name,
            position: s.position,
            category: s.category,
            color: s.color,
          })),
        },
      };
    });

    const last = page.at(-1);
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${last.createdAt.getTime()}_${last.id}`, 'utf8').toString('base64url')
        : null;

    return { items, nextCursor };
  }

  /**
   * Job detail + Kanban cards from the slice DB (drained candidates/applications).
   * `members` and `requiredSkills` are empty; comment/reaction badges are zero until those domains move.
   */
  async get(accountId: string, jobId: string, ctx: JobRequestContext = {}) {
    const job = await this.db.job.findFirst({
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

    let owner: { id: string; displayName: string | null; email: string; avatarUrl: string | null } | null = null;
    if (job.ownerId) {
      const m = await this.accounts.resolveMemberProfiles(accountId, [job.ownerId], ctx.authorization);
      const o = m.get(job.ownerId);
      if (o) {
        owner = { id: o.id, displayName: o.displayName, email: o.email, avatarUrl: o.avatarUrl ?? null };
      }
    }

    const applications = job.applications.map((a) => ({
      id: a.id,
      candidateId: a.candidateId,
      jobId: a.jobId,
      currentStatusId: a.currentStatusId,
      position: a.position,
      version: a.version,
      appliedAt: a.appliedAt,
      lastTransitionAt: a.lastTransitionAt,
      commentCount: 0,
      reactionSummary: {
        counts: { THUMBS_UP: 0, THUMBS_DOWN: 0, STAR: 0 },
        myReactions: [] as string[],
      },
      candidate: {
        id: a.candidate.id,
        firstName: a.candidate.firstName,
        lastName: a.candidate.lastName,
        headline: a.candidate.headline,
        email: a.candidate.email,
        currentTitle: a.candidate.currentTitle,
        currentCompany: a.candidate.currentCompany,
        yearsExperience: a.candidate.yearsExperience,
        location: a.candidate.location,
      },
    }));

    return {
      id: job.id,
      title: job.title,
      description: job.description,
      department: job.department,
      location: job.location,
      clientName: job.clientName,
      headCount: job.headCount,
      employmentType: job.employmentType,
      status: job.status,
      pipelineId: job.pipelineId,
      requiredSkillIds: job.requiredSkillIds,
      ownerId: job.ownerId,
      openedAt: job.openedAt,
      closedAt: job.closedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      owner,
      pipeline: {
        id: job.pipeline.id,
        name: job.pipeline.name,
        isDefault: job.pipeline.isDefault,
        statuses: job.pipeline.statuses.map((s) => ({
          id: s.id,
          name: s.name,
          position: s.position,
          category: s.category,
          color: s.color,
        })),
      },
      applications,
      members: [] as unknown[],
      requiredSkills: [] as unknown[],
    };
  }

  static parseListQuery(params: {
    q?: string;
    status?: string;
    includeArchived?: string;
    limit?: string;
    cursor?: string;
  }): ListJobsQuery {
    let parsedStatus: JobStatus | undefined;
    if (params.status !== undefined && params.status !== '') {
      if (!JOB_STATUSES.includes(params.status as JobStatus)) {
        throw new BadRequestException(`status must be one of: ${JOB_STATUSES.join(', ')}`);
      }
      parsedStatus = params.status as JobStatus;
    }

    let parsedLimit: number | undefined;
    if (params.limit !== undefined && params.limit !== '') {
      const n = Number(params.limit);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 100) {
        throw new BadRequestException('limit must be an integer between 1 and 100');
      }
      parsedLimit = n;
    }

    const parsedIncludeArchived = JobDomainService.parseOptionalBool(params.includeArchived, 'includeArchived');

    return {
      q: params.q,
      status: parsedStatus,
      includeArchived: parsedIncludeArchived,
      limit: parsedLimit,
      cursor: params.cursor || undefined,
    };
  }

  private static parseOptionalBool(raw: string | undefined, name: string): boolean | undefined {
    if (raw === undefined || raw === '') return undefined;
    const v = raw.toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
    throw new BadRequestException(`${name} must be "true" or "false"`);
  }
}
