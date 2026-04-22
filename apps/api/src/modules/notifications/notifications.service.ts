import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, NotificationKind } from '.prisma/regional';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

export interface NotificationEntry {
  id: string;
  kind: NotificationKind;
  resource: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
  actor: {
    id: string;
    displayName: string | null;
    email: string;
    avatarUrl: string | null;
  } | null;
}

export interface ListOptions {
  /** When true, only return notifications where readAt IS NULL. */
  unreadOnly?: boolean;
  /** Cursor — return entries strictly older than this ISO timestamp. */
  before?: string;
  /** Max entries (clamped 1..100). */
  limit?: number;
}

/**
 * Per-user notification inbox.
 *
 * Notifications are write-once and either created automatically by other
 * services (mention extraction in Comments/Notes, JobMember add) or
 * directly by the controller for tests. Reads are designed to be cheap so
 * the bell can poll the unread count on a 30s interval without measurable
 * load: a single indexed count + an equally indexed listing query.
 *
 * Multi-tenant safety: every read/write is scoped by both `accountId` AND
 * `userId` so a user cannot see notifications from another account they
 * happen to be a member of, even if that account routes to the same
 * region as theirs.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly router: RegionRouterService,
    private readonly global: GlobalPrismaService,
  ) {}

  async list(
    accountId: string,
    userId: string,
    opts: ListOptions = {},
  ): Promise<{ entries: NotificationEntry[]; nextBefore: string | null; unreadCount: number }> {
    const { client } = await this.router.forAccount(accountId);
    const limit = Math.max(1, Math.min(100, opts.limit ?? 30));
    const before = opts.before ? new Date(opts.before) : undefined;

    const where: Prisma.NotificationWhereInput = {
      accountId,
      userId,
      ...(opts.unreadOnly ? { readAt: null } : {}),
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
    };

    const [rows, unreadCount] = await Promise.all([
      client.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
      client.notification.count({ where: { accountId, userId, readAt: null } }),
    ]);

    // Hydrate actor display info from the global user table in one batch.
    const actorIds = Array.from(
      new Set(rows.map((r) => (r.metadata as { actorUserId?: string } | null)?.actorUserId).filter(Boolean)),
    ) as string[];
    const actors = actorIds.length
      ? await this.global.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true, email: true, avatarUrl: true },
        })
      : [];
    const actorById = new Map(actors.map((u) => [u.id, u] as const));

    const entries: NotificationEntry[] = rows.map((r) => {
      const meta = (r.metadata as Record<string, unknown>) ?? {};
      const actorUserId = typeof meta.actorUserId === 'string' ? meta.actorUserId : null;
      return {
        id: r.id,
        kind: r.kind,
        resource: r.resource,
        metadata: meta,
        createdAt: r.createdAt,
        readAt: r.readAt,
        actor: actorUserId ? actorById.get(actorUserId) ?? null : null,
      };
    });

    return {
      entries,
      nextBefore: rows.length === limit ? rows[rows.length - 1]!.createdAt.toISOString() : null,
      unreadCount,
    };
  }

  async unreadCount(accountId: string, userId: string): Promise<{ unread: number }> {
    const { client } = await this.router.forAccount(accountId);
    const unread = await client.notification.count({
      where: { accountId, userId, readAt: null },
    });
    return { unread };
  }

  /**
   * Mark a specific set, or all of the user's unread notifications, as
   * read. Idempotent — already-read entries are simply ignored. Returns
   * the count of newly-read rows for the UI to optimistically decrement.
   */
  async markRead(
    accountId: string,
    userId: string,
    opts: { ids?: string[]; all?: boolean },
  ): Promise<{ marked: number }> {
    const { client } = await this.router.forAccount(accountId);
    const where: Prisma.NotificationWhereInput = { accountId, userId, readAt: null };
    if (!opts.all) {
      const ids = (opts.ids ?? []).filter((s) => typeof s === 'string' && s.length > 0);
      if (ids.length === 0) return { marked: 0 };
      where.id = { in: ids };
    }
    const res = await client.notification.updateMany({ where, data: { readAt: new Date() } });
    return { marked: res.count };
  }

  /**
   * Internal API — create a notification on behalf of another service. Skips
   * self-notifications (you don't want a buzz when you @-mention yourself
   * in your own comment).
   */
  async notify(
    accountId: string,
    userId: string,
    actorUserId: string | null,
    kind: NotificationKind,
    resource: string,
    metadata: Record<string, unknown> = {},
  ): Promise<{ id: string } | null> {
    if (actorUserId && actorUserId === userId) return null;
    const { client } = await this.router.forAccount(accountId);
    const created = await client.notification.create({
      data: {
        accountId,
        userId,
        kind,
        resource,
        metadata: {
          ...(actorUserId ? { actorUserId } : {}),
          ...metadata,
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return created;
  }

  /**
   * Resolve a body's `@mentions` against the account's membership roster
   * and emit a `MENTION` notification per resolved recipient. Tokens are
   * matched case-insensitively against email local-parts, full email
   * addresses, and `@displayName` with spaces replaced by `.` or `_`.
   *
   * Returns the list of notified user ids (deduped) so callers can log /
   * test without re-querying.
   */
  async notifyMentions(opts: {
    accountId: string;
    actorUserId: string;
    body: string;
    resource: string;
    metadata?: Record<string, unknown>;
  }): Promise<string[]> {
    const tokens = extractMentionTokens(opts.body);
    if (tokens.length === 0) return [];

    // Account members are stored in the global DB; we don't need a regional
    // round-trip here.
    const memberships = await this.global.membership.findMany({
      where: { accountId: opts.accountId },
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });

    const matched = new Set<string>();
    for (const t of tokens) {
      for (const m of memberships) {
        if (mentionMatches(t, m.user.email, m.user.displayName ?? null)) {
          matched.add(m.user.id);
        }
      }
    }
    matched.delete(opts.actorUserId); // never notify self

    const notified: string[] = [];
    for (const userId of matched) {
      const created = await this.notify(
        opts.accountId,
        userId,
        opts.actorUserId,
        'MENTION',
        opts.resource,
        {
          snippet: opts.body.slice(0, 240),
          ...(opts.metadata ?? {}),
        },
      );
      if (created) notified.push(userId);
    }
    return notified;
  }
}

/**
 * Pull `@token` substrings out of a body. Tokens are alphanumeric +
 * `._-+@`, capped at 64 chars to avoid pathological input. We require the
 * `@` to be at the start of the string or follow whitespace / punctuation
 * so we don't pick up email addresses *inside* a paragraph (those usually
 * shouldn't trigger a notification).
 */
function extractMentionTokens(body: string): string[] {
  if (!body) return [];
  const out = new Set<string>();
  const re = /(^|[\s,.;:!?(\[{<])@([A-Za-z0-9._+\-@]{1,64})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const tok = (m[2] ?? '').trim();
    if (tok.length > 0) out.add(tok.toLowerCase());
  }
  return Array.from(out);
}

/**
 * Decide whether a `@token` refers to a member.
 *
 * We accept several shapes that map to the same person so end users don't
 * have to memorize the canonical handle:
 *   - the full email (`@ada@example.com`)
 *   - the email local-part (`@ada`)
 *   - the display name with spaces → `.` or `_` (`@ada.lovelace`)
 *   - the display name lowercased and concatenated (`@adalovelace`)
 */
function mentionMatches(token: string, email: string, displayName: string | null): boolean {
  const t = token.toLowerCase();
  if (t === email.toLowerCase()) return true;
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (t === local) return true;
  if (displayName) {
    const dn = displayName.toLowerCase();
    if (t === dn.replace(/\s+/g, '.')) return true;
    if (t === dn.replace(/\s+/g, '_')) return true;
    if (t === dn.replace(/\s+/g, '')) return true;
  }
  return false;
}

// Re-export the parser helpers for tests.
export const __test__ = { extractMentionTokens, mentionMatches };
