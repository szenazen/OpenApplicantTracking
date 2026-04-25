import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PipelineDomainService } from './pipeline-domain.service';
import { PipelinesRestController } from './pipelines-rest.controller';

@Module({
  imports: [PrismaModule, AuthModule, DomainEventsModule],
  controllers: [PipelinesRestController],
  providers: [PipelineDomainService],
  exports: [PipelineDomainService],
})
export class PipelinesModule {}
