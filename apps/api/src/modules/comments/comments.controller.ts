import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId, AuthUser, CurrentUser } from '../../common/request-context';
import { CommentsService } from './comments.service';

class CreateCommentDto {
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
}

class UpdateCommentDto {
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsInt() @Min(0) expectedVersion!: number;
}

class DeleteCommentQuery {
  // Query strings arrive as strings; coerce so @IsInt sees a number.
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}

@ApiTags('comments')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller()
export class CommentsController {
  constructor(private readonly svc: CommentsService) {}

  /** Newest-first comments on an application (author display info included). */
  @Get('applications/:applicationId/comments')
  list(@AccountId() accountId: string, @Param('applicationId') applicationId: string) {
    return this.svc.listForApplication(accountId, applicationId);
  }

  /**
   * Create a comment. Honours the `Idempotency-Key` header for safe retry —
   * the same key replayed on the same application is a no-op that returns
   * the already-created comment.
   */
  @Post('applications/:applicationId/comments')
  create(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() dto: CreateCommentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.svc.create(accountId, applicationId, dto, user.userId, idempotencyKey || undefined);
  }

  @Patch('comments/:id')
  update(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.svc.update(accountId, id, dto, user.userId);
  }

  @Delete('comments/:id')
  remove(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: DeleteCommentQuery,
  ) {
    return this.svc.remove(accountId, id, user.userId, query.expectedVersion);
  }
}
