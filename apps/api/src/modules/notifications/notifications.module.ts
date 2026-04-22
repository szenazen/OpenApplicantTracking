import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { RegionRouterModule } from '../../infrastructure/region-router/region-router.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [PrismaModule, RegionRouterModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  // Exported so CommentsModule, NotesModule, JobMembersModule can call
  // `notify` / `notifyMentions` without re-instantiating the service.
  exports: [NotificationsService],
})
export class NotificationsModule {}
