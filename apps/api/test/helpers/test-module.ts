/**
 * Shared Nest test module factory. Builds a real ConfigModule + PrismaModule
 * against the live dev DBs. Tests clean up their own data by email/slug prefix.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { appConfig } from '../../src/config/app.config';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { RegionRouterModule } from '../../src/infrastructure/region-router/region-router.module';

/**
 * Returns a NestJS TestingModule builder with the full config + prisma layer
 * already wired. Callers add domain modules they want to exercise.
 */
export function createTestingModule() {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [appConfig], ignoreEnvFile: true, cache: false }),
      PrismaModule,
      RegionRouterModule,
    ],
  });
}

/** Unique prefix so parallel test runs don't collide (e.g. on CI). */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
