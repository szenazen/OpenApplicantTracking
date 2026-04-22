import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JobMemberRole } from '.prisma/regional';
import { GlobalPrismaService } from '../infrastructure/prisma/global-prisma.service';
import { RegionRouterService } from '../infrastructure/region-router/region-router.service';

/**
 * Job-scoped authorization on top of account membership.
 *
 * Matrix (high level):
 *   - Account **admin** role: full access to all job actions (bootstrap / break-glass).
 *   - **OWNER**, **RECRUITER**, **HIRING_MANAGER**: edit job metadata, move
 *     candidates, add applications.
 *   - **INTERVIEWER**: move candidates only (stage hygiene without editing the req).
 *   - **OBSERVER**: read-only — cannot edit job, team, or move cards.
 *
 * **Legacy jobs** with zero `JobMember` rows remain editable by any active
 * account member so we don't brick existing tenants before they assign a team.
 */
@Injectable()
export class JobPermissionsService {
  constructor(
    private readonly router: RegionRouterService,
    private readonly global: GlobalPrismaService,
  ) {}

  async assertActiveAccountMember(accountId: string, userId: string) {
    const m = await this.global.membership.findUnique({
      where: { userId_accountId: { userId, accountId } },
      select: { status: true },
    });
    if (!m || m.status !== 'ACTIVE') {
      throw new ForbiddenException('Not an active member of this account');
    }
  }

  async isAccountAdmin(accountId: string, userId: string): Promise<boolean> {
    const row = await this.global.membership.findUnique({
      where: { userId_accountId: { userId, accountId } },
      select: { status: true, role: { select: { name: true } } },
    });
    return row?.status === 'ACTIVE' && row.role.name === 'admin';
  }

  private async memberCount(accountId: string, jobId: string): Promise<number> {
    const { client } = await this.router.forAccount(accountId);
    return client.jobMember.count({ where: { accountId, jobId } });
  }

  private async jobRole(
    accountId: string,
    jobId: string,
    userId: string,
  ): Promise<JobMemberRole | null> {
    const { client } = await this.router.forAccount(accountId);
    const hit = await client.jobMember.findFirst({
      where: { accountId, jobId, userId },
      select: { role: true },
    });
    return hit?.role ?? null;
  }

  /**
   * Edit job fields (PATCH /jobs/:id) — not team membership.
   */
  async assertCanEditJob(accountId: string, jobId: string, userId: string) {
    if (await this.isAccountAdmin(accountId, userId)) return;
    const { client } = await this.router.forAccount(accountId);
    const job = await client.job.findFirst({ where: { id: jobId, accountId }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');

    const role = await this.jobRole(accountId, jobId, userId);
    if (role) {
      if (
        role !== JobMemberRole.OWNER &&
        role !== JobMemberRole.RECRUITER &&
        role !== JobMemberRole.HIRING_MANAGER
      ) {
        throw new ForbiddenException('Your job role cannot edit this requisition');
      }
      return;
    }
    if ((await this.memberCount(accountId, jobId)) === 0) {
      await this.assertActiveAccountMember(accountId, userId);
      return;
    }
    throw new ForbiddenException('You are not on this job team');
  }

  /**
   * Add / remove / change job members.
   */
  async assertCanManageJobTeam(accountId: string, jobId: string, userId: string) {
    if (await this.isAccountAdmin(accountId, userId)) return;
    const role = await this.jobRole(accountId, jobId, userId);
    if (role === JobMemberRole.OWNER || role === JobMemberRole.RECRUITER) return;
    if ((await this.memberCount(accountId, jobId)) === 0) {
      await this.assertActiveAccountMember(accountId, userId);
      return;
    }
    throw new ForbiddenException('Only a job owner or recruiter can manage the team');
  }

  /**
   * Move Kanban cards or create applications.
   */
  async assertCanMoveApplications(accountId: string, jobId: string, userId: string) {
    if (await this.isAccountAdmin(accountId, userId)) return;
    const role = await this.jobRole(accountId, jobId, userId);
    if (
      role === JobMemberRole.OWNER ||
      role === JobMemberRole.RECRUITER ||
      role === JobMemberRole.HIRING_MANAGER ||
      role === JobMemberRole.INTERVIEWER
    ) {
      return;
    }
    if ((await this.memberCount(accountId, jobId)) === 0) {
      await this.assertActiveAccountMember(accountId, userId);
      return;
    }
    throw new ForbiddenException('Your job role cannot change pipeline stages');
  }
}
