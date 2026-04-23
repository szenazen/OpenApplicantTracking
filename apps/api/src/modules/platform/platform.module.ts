import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { PlatformAdminGuard } from '../../common/platform-admin.guard';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [AccountsModule],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAdminGuard],
})
export class PlatformModule {}
