import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { ReactionsModule } from '../reactions/reactions.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [AccountsModule, ReactionsModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
