import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '.prisma/global';

/**
 * Thin wrapper around the global PrismaClient.
 * One connection pool per API process for the control-plane database.
 */
@Injectable()
export class GlobalPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GlobalPrismaService.name);

  constructor() {
    super({
      datasources: { db: { url: process.env.GLOBAL_DATABASE_URL } },
      log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('connected to global datasource');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
