import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { appConfig } from './config/app.config';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RegionRouterModule } from './infrastructure/region-router/region-router.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { SkillsModule } from './modules/skills/skills.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { PipelinesModule } from './modules/pipelines/pipelines.module';
import { CandidatesModule } from './modules/candidates/candidates.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { NotesModule } from './modules/notes/notes.module';
import { CommentsModule } from './modules/comments/comments.module';
import { ReactionsModule } from './modules/reactions/reactions.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { JobMembersModule } from './modules/job-members/job-members.module';
import { SourcingModule } from './modules/sourcing/sourcing.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RealtimeModule } from './modules/realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig], cache: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    RegionRouterModule,
    HealthModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    SkillsModule,
    JobsModule,
    PipelinesModule,
    CandidatesModule,
    ApplicationsModule,
    NotesModule,
    CommentsModule,
    ReactionsModule,
    ActivitiesModule,
    JobMembersModule,
    SourcingModule,
    RecommendationsModule,
    ReportsModule,
    RealtimeModule,
  ],
})
export class AppModule {}
