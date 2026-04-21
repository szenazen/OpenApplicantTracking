import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

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

    const [hydrated] = await this.hydrateAuthors([created]);
    return hydrated;
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
