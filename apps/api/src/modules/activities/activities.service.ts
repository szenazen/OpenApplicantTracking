import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '.prisma/regional';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

export interface ActivityEntry {
  id: string;
  createdAt: Date;
  action: string;
  resource: string;
  actorUserId: string | null;
  actor: { id: string; displayName: string | null; email: string; avatarUrl: string | null } | null;
  metadata: Record<string, unknown>;
}

export interface ListActivitiesOptions {
  /** ISO timestamp — return entries strictly older than this (keyset pagination). */
  before?: string;
  /** Max entries to return. Server-clamped to [1, 100]. */
  limit?: number;
}

/**
 * Activities feed service.
 *
 * Presents a single chronological timeline of everything that happened on a
 * job, sourced from the regional {@link AuditEvent} log. Every write path
 * (application move, note/comment/reaction mutations, etc.) stamps
 * `metadata.jobId` at emit time, so filtering the feed by job is a single
 * JSON-path predicate with no joins.
 *
 * Author display info is fetched in a single batch from the global user
 * table so the tab renders avatar + name inline.
 *
 * Pagination: keyset on `createdAt` via `?before=<iso>&limit=<n>`; stable
 * under concurrent writes (no offsets, no skipped rows).
 */
@Injectable()
export class ActivitiesService {
  constructor(
    private readonly router: RegionRouterService,
    private readonly global: GlobalPrismaService,
  ) {}

  async listForJob(accountId: string, jobId: string, opts: ListActivitiesOptions = {}) {
    const { client } = await this.router.forAccount(accountId);
    const job = await client.job.findFirst({ where: { id: jobId, accountId }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');

    const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
    const before = opts.before ? new Date(opts.before) : undefined;
    if (before && Number.isNaN(before.getTime())) {
      // Silently ignore a malformed cursor — treat as a fresh page request.
      opts.before = undefined;
    }

    const where: Prisma.AuditEventWhereInput = {
      accountId,
      metadata: { path: ['jobId'], equals: jobId },
      ...(before ? { createdAt: { lt: before } } : {}),
    };

    const rows = await client.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Batch-hydrate actor display info.
    const actorIds = Array.from(new Set(rows.map((r) => r.actorUserId).filter(Boolean))) as string[];
    const users = actorIds.length
      ? await this.global.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true, email: true, avatarUrl: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u] as const));

    const entries: ActivityEntry[] = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      resource: r.resource,
      actorUserId: r.actorUserId,
      actor: r.actorUserId ? byId.get(r.actorUserId) ?? null : null,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    }));

    return {
      entries,
      /** Cursor for the next page: ISO timestamp of the last entry, or null if this was the tail. */
      nextBefore: rows.length === limit ? rows[rows.length - 1]!.createdAt.toISOString() : null,
    };
  }
}
