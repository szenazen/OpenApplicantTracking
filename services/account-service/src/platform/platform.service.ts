import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Platform-wide reads on the global directory. Provisioning
 * `POST /platform/accounts` stays on the monolith (regional DB + pipeline bootstrap).
 */
@Injectable()
export class PlatformService {
  constructor(private readonly db: PrismaService) {}

  async listAccounts() {
    const rows = await this.db.accountDirectory.findMany({
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
}
