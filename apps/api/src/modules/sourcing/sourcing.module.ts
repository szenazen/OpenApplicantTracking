import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { SourcingController } from './sourcing.controller';
import { SourcingService } from './sourcing.service';

@Module({
  imports: [AccountsModule],
  controllers: [SourcingController],
  providers: [SourcingService],
  exports: [SourcingService],
})
export class SourcingModule {}
