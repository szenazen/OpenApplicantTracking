import { Global, Module } from '@nestjs/common';
import { RegionRouterService } from './region-router.service';

@Global()
@Module({
  providers: [RegionRouterService],
  exports: [RegionRouterService],
})
export class RegionRouterModule {}
