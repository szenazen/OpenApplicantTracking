import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { DomainEventsModule } from './domain-events/domain-events.module';
import { PipelinesModule } from './pipelines/pipelines.module';
import { PipelineSliceModule } from './slice/pipeline-slice.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    AuthModule,
    DomainEventsModule,
    PipelinesModule,
    HealthModule,
    PipelineSliceModule,
  ],
})
export class AppModule {}
