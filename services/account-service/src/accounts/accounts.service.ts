import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Read-only account resolution for a member — mirrors {@link AccountsService.getForUser}
 * in the monolith until routes are fully strangler-migrated.
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
}
