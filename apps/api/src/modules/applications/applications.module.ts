import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { ReactionsModule } from '../reactions/reactions.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [AccountsModule, RealtimeModule, ReactionsModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
