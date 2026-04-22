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

export interface CreateNoteInput {
  body: string;
}

export interface UpdateNoteInput {
  body: string;
  /** Optimistic-concurrency token — must match current note.version. */
  expectedVersion: number;
}

/**
 * Service for job-scoped collaboration notes.
 *
 * Follows the reliability callouts in design/ATS-design.drawio.xml (Notes):
 *   - Idempotency-Key protects POSTs against double-submit (unique constraint
 *     on `[jobId, idempotencyKey]`).
 *   - `expectedVersion` enforces optimistic concurrency on update/delete so
 *     two editors don't silently clobber each other.
 * Deletes are soft so the Activities tab can still surface a "note removed"
 * entry in the timeline.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly router: RegionRouterService,
    private readonly global: GlobalPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Newest-first list of visible notes on a job, with author display info. */
  async listForJob(accountId: string, jobId: string) {
    const { client } = await this.router.forAccount(accountId);
    const job = await client.job.findFirst({ where: { id: jobId, accountId }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');

    const notes = await client.jobNote.findMany({
      where: { jobId, accountId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return this.hydrateAuthors(notes);
  }

  async create(
    accountId: string,
    jobId: string,
    input: CreateNoteInput,
    actorUserId: string,
    idempotencyKey?: string,
  ) {
    const body = normalizeBody(input.body);
    const { client } = await this.router.forAccount(accountId);

    const job = await client.job.findFirst({ where: { id: jobId, accountId }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');

    if (idempotencyKey) {
      const prior = await client.jobNote.findUnique({
        where: { jobId_idempotencyKey: { jobId, idempotencyKey } },
      });
      if (prior) {
        const [hydrated] = await this.hydrateAuthors([prior]);
        return hydrated;
      }
    }

    const note = await client.$transaction(async (tx) => {
      const created = await tx.jobNote.create({
        data: {
          accountId,
          jobId,
          authorUserId: actorUserId,
          body,
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'note.created',
          resource: `note:${created.id}`,
          metadata: { jobId, noteId: created.id },
        },
      });
      return created;
    });

    await this.notifications
      .notifyMentions({
        accountId,
        actorUserId,
        body,
        resource: `job:${jobId}`,
        metadata: { jobId, noteId: note.id, source: 'note' },
      })
      .catch(() => undefined);

    const [hydrated] = await this.hydrateAuthors([note]);
    return hydrated;
  }

  async update(
    accountId: string,
    noteId: string,
    input: UpdateNoteInput,
    actorUserId: string,
  ) {
    const body = normalizeBody(input.body);
    const { client } = await this.router.forAccount(accountId);

    const current = await client.jobNote.findFirst({ where: { id: noteId, accountId, deletedAt: null } });
    if (!current) throw new NotFoundException('Note not found');
    if (current.authorUserId !== actorUserId) {
      throw new ForbiddenException('Only the author can edit this note');
    }
    if (input.expectedVersion !== current.version) {
      throw new ConflictException({
        message: 'Note version mismatch — reload to reconcile.',
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      });
    }

    const updated = await client.$transaction(async (tx) => {
      const next = await tx.jobNote.update({
        where: { id: noteId },
        data: { body, version: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'note.updated',
          resource: `note:${noteId}`,
          metadata: { jobId: current.jobId, noteId, version: next.version },
        },
      });
      return next;
    });

    await this.notifications
      .notifyMentions({
        accountId,
        actorUserId,
        body,
        resource: `job:${current.jobId}`,
        metadata: { jobId: current.jobId, noteId, source: 'note' },
      })
      .catch(() => undefined);

    const [hydrated] = await this.hydrateAuthors([updated]);
    return hydrated;
  }

  async remove(accountId: string, noteId: string, actorUserId: string, expectedVersion?: number) {
    const { client } = await this.router.forAccount(accountId);
    const current = await client.jobNote.findFirst({ where: { id: noteId, accountId, deletedAt: null } });
    if (!current) throw new NotFoundException('Note not found');
    if (current.authorUserId !== actorUserId) {
      throw new ForbiddenException('Only the author can delete this note');
    }
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new ConflictException({
        message: 'Note version mismatch — reload to reconcile.',
        expectedVersion,
        actualVersion: current.version,
      });
    }

    await client.$transaction(async (tx) => {
      await tx.jobNote.update({
        where: { id: noteId },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'note.deleted',
          resource: `note:${noteId}`,
          metadata: { jobId: current.jobId, noteId },
        },
      });
    });

    return { ok: true };
  }

  /**
   * Join author display info from the global `users` table so the UI can
   * render avatar + name without a second round-trip.
   */
  private async hydrateAuthors<T extends { authorUserId: string }>(
    notes: T[],
  ): Promise<(T & { author: { id: string; displayName: string | null; email: string; avatarUrl: string | null } | null })[]> {
    if (notes.length === 0) return [];
    const ids = Array.from(new Set(notes.map((n) => n.authorUserId)));
    const users = await this.global.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, email: true, avatarUrl: true },
    });
    const byId = new Map(users.map((u) => [u.id, u] as const));
    return notes.map((n) => ({ ...n, author: byId.get(n.authorUserId) ?? null }));
  }
}

function normalizeBody(raw: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new BadRequestException('Note body cannot be empty');
  }
  if (trimmed.length > 5000) {
    throw new BadRequestException('Note body is too long (max 5000 chars)');
  }
  return trimmed;
}
