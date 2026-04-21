import { Injectable, NotFoundException } from '@nestjs/common';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

export const REACTION_KINDS = ['THUMBS_UP', 'THUMBS_DOWN', 'STAR'] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export interface ReactionSummary {
  counts: Record<ReactionKind, number>;
  myReactions: ReactionKind[];
}

/**
 * Service for application-scoped reactions.
 *
 * Each (application, user, kind) tuple is unique (DB-enforced) — so the
 * operation is naturally idempotent: PUT → create-if-missing, DELETE →
 * remove-if-present. This mirrors the "toggle" UX on the drawer.
 */
@Injectable()
export class ReactionsService {
  constructor(private readonly router: RegionRouterService) {}

  async summarize(accountId: string, applicationId: string, userId: string): Promise<ReactionSummary> {
    const { client } = await this.router.forAccount(accountId);
    await this.assertApplication(client, accountId, applicationId);

    const rows = await client.applicationReaction.findMany({
      where: { accountId, applicationId },
      select: { kind: true, userId: true },
    });
    const counts = emptyCounts();
    const mine: ReactionKind[] = [];
    for (const r of rows) {
      counts[r.kind as ReactionKind]++;
      if (r.userId === userId) mine.push(r.kind as ReactionKind);
    }
    return { counts, myReactions: mine };
  }

  /** Bulk summary for a set of applications — used to decorate Kanban cards. */
  async summarizeMany(
    accountId: string,
    applicationIds: string[],
    userId: string,
  ): Promise<Map<string, ReactionSummary>> {
    if (applicationIds.length === 0) return new Map();
    const { client } = await this.router.forAccount(accountId);
    const rows = await client.applicationReaction.findMany({
      where: { accountId, applicationId: { in: applicationIds } },
      select: { applicationId: true, kind: true, userId: true },
    });
    const out = new Map<string, ReactionSummary>();
    for (const id of applicationIds) out.set(id, { counts: emptyCounts(), myReactions: [] });
    for (const r of rows) {
      const s = out.get(r.applicationId)!;
      s.counts[r.kind as ReactionKind]++;
      if (r.userId === userId) s.myReactions.push(r.kind as ReactionKind);
    }
    return out;
  }

  /** PUT: add my reaction if not present. Idempotent — no 409 on retry. */
  async add(accountId: string, applicationId: string, kind: ReactionKind, userId: string) {
    const { client } = await this.router.forAccount(accountId);
    await this.assertApplication(client, accountId, applicationId);

    await client.$transaction(async (tx) => {
      const existing = await tx.applicationReaction.findUnique({
        where: { applicationId_userId_kind: { applicationId, userId, kind } },
      });
      if (existing) return;
      await tx.applicationReaction.create({
        data: { accountId, applicationId, userId, kind },
      });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId: userId,
          action: 'reaction.added',
          resource: `application:${applicationId}`,
          metadata: { applicationId, kind },
        },
      });
    });

    return this.summarize(accountId, applicationId, userId);
  }

  /** DELETE: remove my reaction if present. Idempotent. */
  async remove(accountId: string, applicationId: string, kind: ReactionKind, userId: string) {
    const { client } = await this.router.forAccount(accountId);
    await this.assertApplication(client, accountId, applicationId);

    await client.$transaction(async (tx) => {
      const existing = await tx.applicationReaction.findUnique({
        where: { applicationId_userId_kind: { applicationId, userId, kind } },
      });
      if (!existing) return;
      await tx.applicationReaction.delete({ where: { id: existing.id } });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId: userId,
          action: 'reaction.removed',
          resource: `application:${applicationId}`,
          metadata: { applicationId, kind },
        },
      });
    });

    return this.summarize(accountId, applicationId, userId);
  }

  private async assertApplication(
    client: Awaited<ReturnType<RegionRouterService['forAccount']>>['client'],
    accountId: string,
    applicationId: string,
  ) {
    const hit = await client.application.findFirst({
      where: { id: applicationId, accountId },
      select: { id: true },
    });
    if (!hit) throw new NotFoundException('Application not found');
  }
}

function emptyCounts(): Record<ReactionKind, number> {
  return { THUMBS_UP: 0, THUMBS_DOWN: 0, STAR: 0 };
}
