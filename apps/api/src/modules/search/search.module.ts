import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { RegionRouterModule } from '../../infrastructure/region-router/region-router.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [PrismaModule, RegionRouterModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
