import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Account + membership operations on the global DB — strangler extract from the monolith.
 */
@Injectable()
export class AccountsService {
  constructor(private readonly db: PrismaService) {}

  async getForUser(userId: string, accountId: string) {
    const membership = await this.db.membership.findUnique({
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
      _service: 'account-service' as const,
    };
  }

  async listMembers(accountId: string) {
    const rows = await this.db.membership.findMany({
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

  async assignableInviteRoles(actorMembershipRole: string) {
    const names =
      actorMembershipRole === 'account_manager'
        ? ['viewer', 'hiring_manager', 'recruiter', 'account_manager']
        : ['viewer', 'hiring_manager', 'recruiter', 'account_manager', 'admin'];
    const rows = await this.db.role.findMany({
      where: { name: { in: names }, scope: 'ACCOUNT' },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });
    return { roles: rows };
  }

  async addMemberByEmail(accountId: string, actorMembershipRole: string, email: string, roleName: string) {
    if (actorMembershipRole === 'account_manager' && roleName === 'admin') {
      throw new ForbiddenException('Account managers cannot assign the admin role');
    }

    const normalized = email.trim().toLowerCase();
    const target = await this.db.user.findUnique({ where: { email: normalized } });
    if (!target) throw new NotFoundException('No registered user with that email');

    const role = await this.db.role.findUnique({ where: { name: roleName } });
    if (!role || role.scope !== 'ACCOUNT') throw new BadRequestException('Invalid role');

    const existing = await this.db.membership.findUnique({
      where: { userId_accountId: { userId: target.id, accountId } },
    });
    if (existing?.status === 'ACTIVE') {
      throw new ConflictException('That user is already an active member of this account');
    }

    if (existing) {
      await this.db.membership.update({
        where: { userId_accountId: { userId: target.id, accountId } },
        data: { status: 'ACTIVE', roleId: role.id },
      });
    } else {
      await this.db.membership.create({
        data: { userId: target.id, accountId, roleId: role.id, status: 'ACTIVE' },
      });
    }

    return { ok: true as const, userId: target.id, role: roleName };
  }
}
