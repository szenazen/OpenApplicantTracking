import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { JobDomainService } from '../jobs/job-domain.service';
import { JobsRestController } from '../jobs/jobs-rest.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PipelineDomainService } from './pipeline-domain.service';
import { PipelinesRestController } from './pipelines-rest.controller';

@Module({
  imports: [PrismaModule, AuthModule, DomainEventsModule],
  controllers: [PipelinesRestController, JobsRestController],
  providers: [PipelineDomainService, JobDomainService],
  exports: [PipelineDomainService, JobDomainService],
})
export class PipelinesModule {}
