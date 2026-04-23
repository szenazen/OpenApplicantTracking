import { Module } from '@nestjs/common';
import { AccountAdminOrManagerGuard } from './account-admin-or-manager.guard';
import { AccountContextGuard } from './account-context.guard';

@Module({
  providers: [AccountContextGuard, AccountAdminOrManagerGuard],
  exports: [AccountContextGuard, AccountAdminOrManagerGuard],
})
export class CommonModule {}
