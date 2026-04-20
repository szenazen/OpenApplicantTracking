import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly router: RegionRouterService,
    private readonly globalDb: GlobalPrismaService,
  ) {}

  @Get()
  async liveness() {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get('ready')
  async readiness() {
    const [global, ...regions] = await Promise.allSettled([
      this.globalDb.$queryRaw`SELECT 1`,
      ...this.router.listRegions().map((r) => this.router.forRegion(r).$queryRaw`SELECT 1`),
    ]);
    return {
      status: global.status === 'fulfilled' && regions.every((r) => r.status === 'fulfilled') ? 'ok' : 'degraded',
      global: global.status,
      regions: Object.fromEntries(
        this.router.listRegions().map((r, i) => [r, regions[i]?.status ?? 'unknown']),
      ),
    };
  }
}
