import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PipelineHealthController } from './pipeline-health.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PipelineHealthController],
})
export class PipelineSliceModule {}
