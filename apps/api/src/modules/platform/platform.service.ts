import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';
import { AccountsService } from '../accounts/accounts.service';

@Injectable()
export class PlatformService {
  constructor(
    private readonly globalDb: GlobalPrismaService,
    private readonly accounts: AccountsService,
  ) {}

  async listAccounts() {
    const rows = await this.globalDb.accountDirectory.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        region: true,
        status: true,
        ownerUserId: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      region: r.region.toLowerCase().replace(/_/g, '-'),
    }));
  }

  async createAccount(params: { name: string; slug: string; region: string; ownerUserId?: string; ownerEmail?: string }) {
    let ownerUserId = params.ownerUserId;
    if (params.ownerEmail) {
      const normalized = params.ownerEmail.trim().toLowerCase();
      const byEmail = await this.globalDb.user.findUnique({ where: { email: normalized } });
      if (!byEmail) throw new NotFoundException('No user with that owner email');
      ownerUserId = byEmail.id;
    }
    if (!ownerUserId) throw new BadRequestException('Provide ownerUserId or ownerEmail');

    const owner = await this.globalDb.user.findUnique({ where: { id: ownerUserId } });
    if (!owner) throw new NotFoundException('Owner user not found');
    return this.accounts.create({
      ownerUserId,
      name: params.name,
      slug: params.slug,
      region: params.region,
    });
  }
}
