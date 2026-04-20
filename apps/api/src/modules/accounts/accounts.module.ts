import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AccountGuard } from '../../common/account.guard';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, AccountGuard],
  exports: [AccountsService, AccountGuard],
})
export class AccountsModule {}
