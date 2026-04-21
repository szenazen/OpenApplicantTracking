import { Body, Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId, AuthUser, CurrentUser } from '../../common/request-context';
import { ApplicationsService } from './applications.service';

class CreateApplicationDto {
  @IsString() @MinLength(1) candidateId!: string;
  @IsString() @MinLength(1) jobId!: string;
  @IsOptional() @IsString() statusId?: string;
}

class MoveApplicationDto {
  @IsString() @MinLength(1) toStatusId!: string;
  @IsInt() @Min(0) toPosition!: number;
  @IsOptional() @IsString() reason?: string;
  /**
   * Optional optimistic-concurrency token. When present we require it to
   * match the current `application.version`; otherwise the move is rejected
   * with 409 Conflict so the client can reconcile.
   */
  @IsOptional() @IsInt() @Min(0) expectedVersion?: number;
}

@ApiTags('applications')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly svc: ApplicationsService) {}

  @Post()
  apply(@AccountId() accountId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateApplicationDto) {
    return this.svc.apply(accountId, dto, user.userId);
  }

  /** Fetch one application with its candidate, job, current status, and full transition history. */
  @Get(':id')
  get(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.get(accountId, id, user.userId);
  }

  /**
   * Move a card. Accepts standard HTTP `Idempotency-Key` header — safe for
   * clients to retry on network errors without creating duplicate history.
   */
  @Patch(':id/move')
  move(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MoveApplicationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.svc.move(accountId, id, dto, user.userId, idempotencyKey || undefined);
  }
}
