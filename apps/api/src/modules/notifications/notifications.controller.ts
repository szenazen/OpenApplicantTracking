import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId, CurrentUser, type AuthUser } from '../../common/request-context';
import { NotificationsService } from './notifications.service';

class ListNotificationsQuery {
  @IsOptional() @Type(() => Boolean) @IsBoolean() unreadOnly?: boolean;
  @IsOptional() @IsISO8601() before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

class MarkReadDto {
  @IsOptional() @IsBoolean() all?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids?: string[];
}

@ApiTags('notifications')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  /** Inbox — newest first. Unread count is included so the UI can update the badge in one call. */
  @Get()
  list(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Query() q: ListNotificationsQuery,
  ) {
    return this.svc.list(accountId, user.userId, {
      unreadOnly: q.unreadOnly,
      before: q.before,
      limit: q.limit,
    });
  }

  /** Lightweight bell-poll endpoint — single COUNT, no payload. */
  @Get('unread-count')
  unread(@AccountId() accountId: string, @CurrentUser() user: AuthUser) {
    return this.svc.unreadCount(accountId, user.userId);
  }

  @Post('mark-read')
  mark(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: MarkReadDto,
  ) {
    return this.svc.markRead(accountId, user.userId, { ids: dto.ids, all: dto.all });
  }
}
