import { Module } from '@nestjs/common';
import { AccountAdminOrManagerGuard } from '../../common/account-admin-or-manager.guard';
import { AccountGuard } from '../../common/account.guard';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService, AccountGuard, AccountAdminOrManagerGuard],
  exports: [AccountsService, AccountGuard, AccountAdminOrManagerGuard],
})
export class AccountsModule {}
