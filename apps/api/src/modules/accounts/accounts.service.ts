import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

const REGION_MAP: Record<string, string> = {
  'us-east-1': 'US_EAST_1',
  'eu-west-1': 'EU_WEST_1',
  'ap-southeast-1': 'AP_SOUTHEAST_1',
  'ap-northeast-1': 'AP_NORTHEAST_1',
  'ap-southeast-2': 'AP_SOUTHEAST_2',
};

@Injectable()
export class AccountsService {
  constructor(
    private readonly globalDb: GlobalPrismaService,
    private readonly router: RegionRouterService,
  ) {}

  /**
   * Creates an Account:
   *   1. inserts into the global AccountsDirectory (records region)
   *   2. provisions the Account row in the chosen region's DB
   *   3. creates a default pipeline with 6 statuses
   *   4. grants the creator an 'admin' membership
   */
  async create(params: {
    ownerUserId: string;
    name: string;
    slug: string;
    region: string; // e.g. 'us-east-1'
  }) {
    const regionEnum = REGION_MAP[params.region];
    if (!regionEnum) throw new BadRequestException(`Unsupported region: ${params.region}`);
    if (!this.router.listRegions().includes(params.region)) {
      throw new BadRequestException(`Region not configured on this deployment: ${params.region}`);
    }

    const existing = await this.globalDb.accountDirectory.findUnique({ where: { slug: params.slug } });
    if (existing) throw new ConflictException('Slug already taken');

    // Ensure we have the system roles.
    const adminRole = await this.globalDb.role.upsert({
      where: { name: 'admin' },
      update: {},
      create: { name: 'admin', scope: 'ACCOUNT', isSystem: true, description: 'Full access within an account' },
    });

    // 1. Global directory
    const directory = await this.globalDb.accountDirectory.create({
      data: {
        name: params.name,
        slug: params.slug,
        region: regionEnum as any,
        ownerUserId: params.ownerUserId,
      },
    });

    // 2. Regional row + default pipeline
    const regional = this.router.forRegion(params.region);
    await regional.$transaction(async (tx) => {
      await tx.account.create({
        data: {
          id: directory.id,
          name: params.name,
          slug: params.slug,
          region: params.region,
        },
      });
      const pipeline = await tx.pipeline.create({
        data: {
          accountId: directory.id,
          name: 'Default Pipeline',
          isDefault: true,
        },
      });
      const defaults = [
        { name: 'New candidate', category: 'NEW' as const, color: '#60a5fa' },
        { name: 'Screening', category: 'IN_PROGRESS' as const, color: '#a78bfa' },
        { name: 'HR Interview', category: 'IN_PROGRESS' as const, color: '#f472b6' },
        { name: 'Technical Interview', category: 'IN_PROGRESS' as const, color: '#facc15' },
        { name: 'Offer', category: 'IN_PROGRESS' as const, color: '#fb923c' },
        { name: 'Hired', category: 'HIRED' as const, color: '#22c55e' },
        { name: 'Dropped', category: 'DROPPED' as const, color: '#ef4444' },
      ];
      await tx.pipelineStatus.createMany({
        data: defaults.map((s, i) => ({ ...s, pipelineId: pipeline.id, position: i })),
      });
    });

    // 3. Membership
    await this.globalDb.membership.create({
      data: {
        userId: params.ownerUserId,
        accountId: directory.id,
        roleId: adminRole.id,
        status: 'ACTIVE',
      },
    });

    return {
      id: directory.id,
      name: directory.name,
      slug: directory.slug,
      region: params.region,
    };
  }

  async getForUser(userId: string, accountId: string) {
    const membership = await this.globalDb.membership.findUnique({
      where: { userId_accountId: { userId, accountId } },
      include: { account: true, role: true },
    });
    if (!membership) throw new NotFoundException('Account not found');
    return {
      id: membership.account.id,
      name: membership.account.name,
      slug: membership.account.slug,
      region: membership.account.region.toLowerCase().replace(/_/g, '-'),
      role: membership.role.name,
    };
  }

  /**
   * List the active members of an account along with their role, for UIs that
   * pick a user (e.g. the "add to job team" picker). Only returns members the
   * caller is allowed to see — guarded by AccountGuard which already verifies
   * the caller has an ACTIVE membership on the same account.
   */
  async listMembers(accountId: string) {
    const rows = await this.globalDb.membership.findMany({
      where: { accountId, status: 'ACTIVE' },
      include: {
        user: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
        role: { select: { name: true } },
      },
      orderBy: [{ role: { name: 'asc' } }, { createdAt: 'asc' }],
    });
    return rows.map((m) => ({
      userId: m.user.id,
      displayName: m.user.displayName,
      email: m.user.email,
      avatarUrl: m.user.avatarUrl,
      role: m.role.name,
      status: m.status,
    }));
  }

  /**
   * Roles the caller may assign when inviting or adding someone to the account.
   * Account managers cannot grant `admin`.
   */
  async assignableInviteRoles(actorMembershipRole: string) {
    const names =
      actorMembershipRole === 'account_manager'
        ? ['viewer', 'hiring_manager', 'recruiter', 'account_manager']
        : ['viewer', 'hiring_manager', 'recruiter', 'account_manager', 'admin'];
    const rows = await this.globalDb.role.findMany({
      where: { name: { in: names }, scope: 'ACCOUNT' },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
    return { roles: rows };
  }

  /**
   * Adds an existing registered user to the account (immediate membership).
   */
  async addMemberByEmail(accountId: string, actorMembershipRole: string, email: string, roleName: string) {
    if (actorMembershipRole === 'account_manager' && roleName === 'admin') {
      throw new ForbiddenException('Account managers cannot assign the admin role');
    }

    const normalized = email.trim().toLowerCase();
    const target = await this.globalDb.user.findUnique({ where: { email: normalized } });
    if (!target) throw new NotFoundException('No registered user with that email');

    const role = await this.globalDb.role.findUnique({ where: { name: roleName } });
    if (!role || role.scope !== 'ACCOUNT') throw new BadRequestException('Invalid role');

    const existing = await this.globalDb.membership.findUnique({
      where: { userId_accountId: { userId: target.id, accountId } },
    });
    if (existing?.status === 'ACTIVE') {
      throw new ConflictException('That user is already an active member of this account');
    }

    if (existing) {
      await this.globalDb.membership.update({
        where: { userId_accountId: { userId: target.id, accountId } },
        data: { status: 'ACTIVE', roleId: role.id },
      });
    } else {
      await this.globalDb.membership.create({
        data: { userId: target.id, accountId, roleId: role.id, status: 'ACTIVE' },
      });
    }

    return { ok: true as const, userId: target.id, role: roleName };
  }
}
