import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { PipelinesController } from './pipelines.controller';
import { PipelinesPrismaService } from './pipelines-prisma.service';
import { PipelinesService } from './pipelines.service';
import { PipelinesSliceClientService } from './pipelines-slice-client.service';

@Module({
  imports: [AccountsModule],
  controllers: [PipelinesController],
  providers: [PipelinesPrismaService, PipelinesSliceClientService, PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
