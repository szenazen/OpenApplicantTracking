import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { JobMembersController } from './job-members.controller';
import { JobMembersService } from './job-members.service';

@Module({
  imports: [AccountsModule, NotificationsModule],
  controllers: [JobMembersController],
  providers: [JobMembersService],
  exports: [JobMembersService],
})
export class JobMembersModule {}
