import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformService } from './platform.service';

@Module({
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAdminGuard],
})
export class PlatformModule {}
