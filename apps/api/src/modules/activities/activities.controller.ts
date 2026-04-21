import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId } from '../../common/request-context';
import { ActivitiesService } from './activities.service';

class ListActivitiesQuery {
  @IsOptional() @IsISO8601() before?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

@ApiTags('activities')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller()
export class ActivitiesController {
  constructor(private readonly svc: ActivitiesService) {}

  /** Job activity feed — newest first, keyset-paginated. */
  @Get('jobs/:jobId/activities')
  list(
    @AccountId() accountId: string,
    @Param('jobId') jobId: string,
    @Query() query: ListActivitiesQuery,
  ) {
    return this.svc.listForJob(accountId, jobId, { before: query.before, limit: query.limit });
  }
}
