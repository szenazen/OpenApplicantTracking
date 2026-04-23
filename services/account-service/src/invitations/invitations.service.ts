import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class InvitationsService {
  constructor(private readonly db: PrismaService) {}

  async listPending(accountId: string) {
    const rows = await this.db.invitation.findMany({
      where: {
        accountId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      include: { role: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role.name,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    }));
  }

  async create(
    accountId: string,
    inviterId: string,
    actorMembershipRole: string,
    email: string,
    roleName: string,
  ) {
    if (actorMembershipRole === 'account_manager' && roleName === 'admin') {
      throw new ForbiddenException('Account managers cannot assign the admin role');
    }

    const role = await this.db.role.findUnique({ where: { name: roleName } });
    if (!role || role.scope !== 'ACCOUNT') {
      throw new BadRequestException('Invalid role for an account invitation');
    }

    const normalized = email.trim().toLowerCase();
    const existingMember = await this.db.membership.findFirst({
      where: { accountId, user: { email: normalized }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (existingMember) {
      throw new ConflictException('That user is already an active member of this account');
    }

    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const row = await this.db.invitation.create({
      data: {
        accountId,
        email: normalized,
        roleId: role.id,
        inviterId,
        token,
        expiresAt,
      },
    });

    return {
      id: row.id,
      email: row.email,
      expiresAt: row.expiresAt,
      token: row.token,
    };
  }

  async revoke(accountId: string, invitationId: string) {
    const res = await this.db.invitation.updateMany({
      where: { id: invitationId, accountId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw new NotFoundException('Invitation not found or already finalized');
    return { ok: true };
  }
}
