import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JobMemberRole, Prisma } from '.prisma/regional';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';
import { NotificationsService } from '../notifications/notifications.service';

export type JobMemberRoleInput = `${JobMemberRole}`;

export interface AddJobMemberInput {
  userId: string;
  role?: JobMemberRoleInput;
}

export interface UpdateJobMemberInput {
  role: JobMemberRoleInput;
}

/**
 * Job-level collaborator service.
 *
 * Adding a user requires:
 *   - the target job exists for this account, and
 *   - the target user already has an ACTIVE global Membership in the account.
 *
 * This mirrors the design: account membership is the perimeter of access;
 * job membership is a capability within that perimeter. Anyone on the job
 * can be pinged for interviews, shown on the header, and receive notifications
 * without the account guard having to special-case anything.
 *
 * Writes emit `job-member.*` audit events (stamped with `jobId`) so the
 * Activities feed can surface team changes alongside other job actions.
 */
@Injectable()
export class JobMembersService {
  constructor(
    private readonly router: RegionRouterService,
    private readonly global: GlobalPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async listForJob(accountId: string, jobId: string) {
    const { client } = await this.router.forAccount(accountId);
    await this.assertJob(client, accountId, jobId);
    const rows = await client.jobMember.findMany({
      where: { accountId, jobId },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return this.hydrateUsers(rows);
  }

  async add(
    accountId: string,
    jobId: string,
    input: AddJobMemberInput,
    actorUserId: string,
  ) {
    if (!input.userId) throw new BadRequestException('userId is required');
    const role = parseRole(input.role) ?? JobMemberRole.RECRUITER;

    const { client } = await this.router.forAccount(accountId);
    await this.assertJob(client, accountId, jobId);

    // Target user must already belong to the account so we never elevate
    // someone from outside the tenant via the job membership path.
    const membership = await this.global.membership.findUnique({
      where: { userId_accountId: { userId: input.userId, accountId } },
      select: { status: true },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('Target user is not an active member of this account');
    }

    try {
      const created = await client.$transaction(async (tx) => {
        const row = await tx.jobMember.create({
          data: {
            accountId,
            jobId,
            userId: input.userId,
            role,
            createdBy: actorUserId,
          },
        });
        await tx.auditEvent.create({
          data: {
            accountId,
            actorUserId,
            action: 'job-member.added',
            resource: `job:${jobId}`,
            metadata: { jobId, jobMemberId: row.id, userId: input.userId, role },
          },
        });
        return row;
      });
      // Fire-and-forget assignment notification so the new collaborator
      // sees the job appear in their bell + "My jobs" without polling.
      await this.notifications
        .notify(accountId, input.userId, actorUserId, 'ASSIGNMENT', `job:${jobId}`, {
          jobId,
          jobMemberId: created.id,
          role,
        })
        .catch(() => undefined);

      const [hydrated] = await this.hydrateUsers([created]);
      return hydrated;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('That user is already on this job');
      }
      throw e;
    }
  }

  async update(
    accountId: string,
    jobMemberId: string,
    input: UpdateJobMemberInput,
    actorUserId: string,
  ) {
    const role = parseRole(input.role);
    if (!role) throw new BadRequestException('Unknown role');
    const { client } = await this.router.forAccount(accountId);
    const current = await client.jobMember.findFirst({
      where: { id: jobMemberId, accountId },
    });
    if (!current) throw new NotFoundException('Job member not found');

    const updated = await client.$transaction(async (tx) => {
      const next = await tx.jobMember.update({
        where: { id: jobMemberId },
        data: { role },
      });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'job-member.updated',
          resource: `job:${current.jobId}`,
          metadata: { jobId: current.jobId, jobMemberId, userId: current.userId, role },
        },
      });
      return next;
    });
    const [hydrated] = await this.hydrateUsers([updated]);
    return hydrated;
  }

  async remove(accountId: string, jobMemberId: string, actorUserId: string) {
    const { client } = await this.router.forAccount(accountId);
    const current = await client.jobMember.findFirst({
      where: { id: jobMemberId, accountId },
    });
    if (!current) throw new NotFoundException('Job member not found');

    await client.$transaction(async (tx) => {
      await tx.jobMember.delete({ where: { id: jobMemberId } });
      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'job-member.removed',
          resource: `job:${current.jobId}`,
          metadata: {
            jobId: current.jobId,
            jobMemberId,
            userId: current.userId,
            role: current.role,
          },
        },
      });
    });
    return { ok: true };
  }

  /**
   * Used by the JobHeader-chip endpoint: same data as `listForJob` but keyed
   * by jobId so the Kanban header can render avatars without a per-job loop.
   */
  async listForJobs(accountId: string, jobIds: string[]) {
    if (jobIds.length === 0) return new Map<string, Awaited<ReturnType<JobMembersService['listForJob']>>>();
    const { client } = await this.router.forAccount(accountId);
    const rows = await client.jobMember.findMany({
      where: { accountId, jobId: { in: jobIds } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    const hydrated = await this.hydrateUsers(rows);
    const byJob = new Map<string, typeof hydrated>();
    for (const m of hydrated) {
      const bucket = byJob.get(m.jobId) ?? [];
      bucket.push(m);
      byJob.set(m.jobId, bucket);
    }
    return byJob;
  }

  private async assertJob(
    client: Awaited<ReturnType<RegionRouterService['forAccount']>>['client'],
    accountId: string,
    jobId: string,
  ) {
    const hit = await client.job.findFirst({ where: { id: jobId, accountId }, select: { id: true } });
    if (!hit) throw new NotFoundException('Job not found');
  }

  private async hydrateUsers<T extends { userId: string }>(rows: T[]) {
    if (rows.length === 0) return rows.map((r) => ({ ...r, user: null }));
    const ids = Array.from(new Set(rows.map((r) => r.userId)));
    const users = await this.global.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true, email: true, avatarUrl: true },
    });
    const byId = new Map(users.map((u) => [u.id, u] as const));
    return rows.map((r) => ({ ...r, user: byId.get(r.userId) ?? null }));
  }
}

function parseRole(value: string | undefined): JobMemberRole | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  return (Object.values(JobMemberRole) as string[]).includes(upper)
    ? (upper as JobMemberRole)
    : undefined;
}
