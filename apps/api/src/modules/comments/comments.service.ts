import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface CreateCommentInput {
  body: string;
}

export interface UpdateCommentInput {
  body: string;
  /** Optimistic-concurrency token — must match current comment.version. */
  expectedVersion: number;
}

/**
 * Service for application-scoped comments (HR + hiring manager feedback on a
 * specific candidate's application).
 *
 * Mirrors the reliability contract of {@link JobNote} (see
 * design/ATS-design.drawio.xml):
 *   - `Idempotency-Key` header → unique([applicationId, idempotencyKey]) so
 *     double-submits return the prior row instead of creating a duplicate.
 *   - `expectedVersion` gate → update/delete reject with 409 if another
 *     collaborator already edited the comment.
 *   - Deletes are soft; Phase F's Activities feed will surface "comment
 *     removed" entries from the `auditEvent` log.
 */
@Injectable()
export class CommentsService {
  constructor(
    private readonly router: RegionRouterService,
    private readonly global: GlobalPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Newest-first list of visible comments on an application. */
  async listForApplication(accountId: string, applicationId: string) {
    const { client } = await this.router.forAccount(accountId);
    await this.assertApplication(client, accountId, applicationId);

    const rows = await client.applicationComment.findMany({
      where: { applicationId, accountId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return this.hydrateAuthors(rows);
  }

  async create(
    accountId: string,
    applicationId: string,
    input: CreateCommentInput,
    actorUserId: string,
    idempotencyKey?: string,
  ) {
    const body = normalizeBody(input.body);
    const { client } = await this.router.forAccount(accountId);
    const { jobId } = await this.assertApplication(client, accountId, applicationId);

    if (idempotencyKey) {
      const prior = await client.applicationComment.findUnique({
        where: { applicationId_idempotencyKey: { applicationId, idempotencyKey } },
      });
      if (prior) {
        const [hydrated] = await this.hydrateAuthors([prior]);
        return hydrated;
      }
    }

    const created = await client.$transaction(async (tx) => {
      const row = await tx.applicationComment.create({
        data: {
          accountId,
          applicationId,
          authorUserId: actorUserId,
          body,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'comment.created',
          resource: `comment:${row.id}`,
          metadata: { jobId, applicationId, commentId: row.id },
        },
      });
      return row;
    });

    // Mention + reply notifications happen out-of-transaction on purpose:
    // the comment is the source of truth, and a transient regional DB blip
    // shouldn't roll back a successful comment. Failures are swallowed so
    // notifications never break the write path.
    const notified = await this.notifications
      .notifyMentions({
        accountId,
        actorUserId,
        body,
        resource: `application:${applicationId}`,
        metadata: { jobId, applicationId, commentId: created.id, source: 'comment' },
      })
      .catch(() => [] as string[]);
    await this.notifyPriorCommenters({
      accountId,
      applicationId,
      actorUserId,
      jobId,
      commentId: created.id,
      body,
      excludeUserIds: new Set(notified),
    }).catch(() => undefined);

    const [hydrated] = await this.hydrateAuthors([created]);
    return hydrated;
  }

  /**
   * Send a `REPLY` notification to every prior commenter on the same
   * application except the current actor and anyone we already pinged via
   * `@mention` — avoids double-buzzing the same user.
   */
  private async notifyPriorCommenters(opts: {
    accountId: string;
    applicationId: string;
    actorUserId: string;
    jobId: string;
    commentId: string;
    body: string;
    excludeUserIds: Set<string>;
  }) {
    const { client } = await this.router.forAccount(opts.accountId);
    const prior = await client.applicationComment.findMany({
      where: { applicationId: opts.applicationId, accountId: opts.accountId, deletedAt: null },
      select: { authorUserId: true },
      distinct: ['authorUserId'],
    });
    const recipients = new Set<string>();
    for (const p of prior) {
      if (p.authorUserId === opts.actorUserId) continue;
      if (opts.excludeUserIds.has(p.authorUserId)) continue;
      recipients.add(p.authorUserId);
    }
    for (const userId of recipients) {
      await this.notifications.notify(opts.accountId, userId, opts.actorUserId, 'REPLY', `application:${opts.applicationId}`, {
        jobId: opts.jobId,
        applicationId: opts.applicationId,
        commentId: opts.commentId,
        snippet: opts.body.slice(0, 240),
        source: 'comment',
      });
    }
  }

  async update(
    accountId: string,
    commentId: string,
    input: UpdateCommentInput,
    actorUserId: string,
  ) {
    const body = normalizeBody(input.body);
    const { client } = await this.router.forAccount(accountId);

    const current = await client.applicationComment.findFirst({
      where: { id: commentId, accountId, deletedAt: null },
      include: { application: { select: { jobId: true } } },
    });
    if (!current) throw new NotFoundException('Comment not found');
    if (current.authorUserId !== actorUserId) {
      throw new ForbiddenException('Only the author can edit this comment');
    }
    if (input.expectedVersion !== current.version) {
      throw new ConflictException({
        message: 'Comment version mismatch — reload to reconcile.',
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      });
    }

    const updated = await client.$transaction(async (tx) => {
      const next = await tx.applicationComment.update({
        where: { id: commentId },
        data: { body, version: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'comment.updated',
          resource: `comment:${commentId}`,
          metadata: {
            jobId: current.application.jobId,
            applicationId: current.applicationId,
            commentId,
            version: next.version,
          },
        },
      });
      return next;
    });

    // Re-run mention extraction so users newly @-mentioned in an edit get
    // notified. Naturally idempotent for already-known recipients only if
    // they read; we accept a small risk of duplicate notifications when an
    // edit re-mentions someone — we'd rather over-notify than miss a ping.
    await this.notifications
      .notifyMentions({
        accountId,
        actorUserId,
        body,
        resource: `application:${current.applicationId}`,
        metadata: {
          jobId: current.application.jobId,
          applicationId: current.applicationId,
          commentId,
          source: 'comment',
        },
      })
      .catch(() => undefined);

    const [hydrated] = await this.hydrateAuthors([updated]);
    return hydrated;
  }

  async remove(
    accountId: string,
    commentId: string,
    actorUserId: string,
    expectedVersion?: number,
  ) {
    const { client } = await this.router.forAccount(accountId);
    const current = await client.applicationComment.findFirst({
      where: { id: commentId, accountId, deletedAt: null },
      include: { application: { select: { jobId: true } } },
    });
    if (!current) throw new NotFoundException('Comment not found');
    if (current.authorUserId !== actorUserId) {
      throw new ForbiddenException('Only the author can delete this comment');
    }
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new ConflictException({
        message: 'Comment version mismatch — reload to reconcile.',
        expectedVersion,
        actualVersion: current.version,
      });
    }

    await client.$transaction(async (tx) => {
      await tx.applicationComment.update({
        where: { id: commentId },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'comment.deleted',
          resource: `comment:${commentId}`,
          metadata: {
            jobId: current.application.jobId,
            applicationId: current.applicationId,
            commentId,
          },
        },
      });
    });

    return { ok: true };
  }

  private async assertApplication(
    client: Awaited<ReturnType<RegionRouterService['forAccount']>>['client'],
    accountId: string,
    applicationId: string,
  ): Promise<{ id: string; jobId: string }> {
    const hit = await client.application.findFirst({
      where: { id: applicationId, accountId },
      select: { id: true, jobId: true },
    });
    if (!hit) throw new NotFoundException('Application not found');
    return hit;
  }

  private async hydrateAuthors<T extends { authorUserId: string }>(
    rows: T[],
  ): Promise<(T & { author: { id: string; displayName: string | null; email: string; avatarUrl: string | null } | null })[]> {
    if (rows.length === 0) return [];
    const ids = Array.from(new Set(rows.map((r) => r.authorUserId)));
    const users = await this.global.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, email: true, avatarUrl: true },
    });
    const byId = new Map(users.map((u) => [u.id, u] as const));
    return rows.map((r) => ({ ...r, author: byId.get(r.authorUserId) ?? null }));
  }
}

function normalizeBody(raw: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) throw new BadRequestException('Comment body cannot be empty');
  if (trimmed.length > 5000) throw new BadRequestException('Comment body is too long (max 5000 chars)');
  return trimmed;
}
