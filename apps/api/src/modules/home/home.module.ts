import { Module } from '@nestjs/common';
import { RegionRouterModule } from '../../infrastructure/region-router/region-router.module';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [RegionRouterModule, PrismaModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
