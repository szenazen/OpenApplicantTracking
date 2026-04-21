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
import { NotesService } from './notes.service';

class CreateNoteDto {
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
}

class UpdateNoteDto {
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsInt() @Min(0) expectedVersion!: number;
}

class DeleteNoteQuery {
  // Incoming query strings are strings — coerce via class-transformer so the
  // @IsInt validator sees a number, not a string like "0".
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) expectedVersion?: number;
}

@ApiTags('notes')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller()
export class NotesController {
  constructor(private readonly svc: NotesService) {}

  /** List notes for a job, newest first, with author display info. */
  @Get('jobs/:jobId/notes')
  list(@AccountId() accountId: string, @Param('jobId') jobId: string) {
    return this.svc.listForJob(accountId, jobId);
  }

  /**
   * Create a note. Supports the standard `Idempotency-Key` header — if the
   * same key is retried for the same job the existing note is returned and
   * no duplicate row is inserted.
   */
  @Post('jobs/:jobId/notes')
  create(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Body() dto: CreateNoteDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.svc.create(accountId, jobId, dto, user.userId, idempotencyKey || undefined);
  }

  @Patch('notes/:id')
  update(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateNoteDto,
  ) {
    return this.svc.update(accountId, id, dto, user.userId);
  }

  @Delete('notes/:id')
  remove(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: DeleteNoteQuery,
  ) {
    return this.svc.remove(accountId, id, user.userId, query.expectedVersion);
  }
}
