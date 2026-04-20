import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient as RegionalPrismaClient } from '.prisma/regional';
import { GlobalPrismaService } from '../prisma/global-prisma.service';

/**
 * Maintains one PrismaClient per configured region (env-driven).
 *
 *   for (const [region, url] of configuredRegions) {
 *     clients.set(region, new RegionalPrismaClient({ datasources: { db: { url } } }))
 *   }
 *
 * At request time the API resolves the region for the active `accountId`
 * via the global `accounts_directory`, then picks the right client.
 */
@Injectable()
export class RegionRouterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegionRouterService.name);
  private readonly clients = new Map<string, RegionalPrismaClient>();
  private readonly accountRegionCache = new Map<string, string>();

  constructor(
    private readonly config: ConfigService,
    private readonly globalDb: GlobalPrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    const regions = this.config.get<Record<string, string>>('db.regions') ?? {};
    for (const [region, url] of Object.entries(regions)) {
      const client = new RegionalPrismaClient({ datasources: { db: { url } } });
      await client.$connect();
      this.clients.set(region, client);
      this.logger.log(`connected to region ${region}`);
    }
    if (this.clients.size === 0) {
      this.logger.warn('no regional datasources configured');
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.$disconnect()));
  }

  /** Regions the API knows about at this moment. */
  listRegions(): string[] {
    return [...this.clients.keys()];
  }

  /** Raw client for a region (use sparingly — prefer forAccount). */
  forRegion(region: string): RegionalPrismaClient {
    const client = this.clients.get(region);
    if (!client) throw new NotFoundException(`Region not configured: ${region}`);
    return client;
  }

  /**
   * Resolve the regional PrismaClient for an account. Caches the account→region
   * mapping in-memory with a soft TTL — invalidated on account-region change
   * (which requires a data migration and is rare).
   */
  async forAccount(accountId: string): Promise<{ client: RegionalPrismaClient; region: string }> {
    let region = this.accountRegionCache.get(accountId);
    if (!region) {
      const record = await this.globalDb.accountDirectory.findUnique({
        where: { id: accountId },
        select: { region: true },
      });
      if (!record) throw new NotFoundException(`Account not found: ${accountId}`);
      // Enum values are stored as "US_EAST_1" — normalize.
      region = record.region.toLowerCase().replace(/_/g, '-');
      this.accountRegionCache.set(accountId, region);
    }
    return { client: this.forRegion(region), region };
  }

  invalidate(accountId: string): void {
    this.accountRegionCache.delete(accountId);
  }
}
