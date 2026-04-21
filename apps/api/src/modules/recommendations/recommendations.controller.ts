import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId } from '../../common/request-context';
import { RecommendationsService } from './recommendations.service';

class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

@ApiTags('recommendations')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('jobs/:jobId/recommendations')
export class RecommendationsController {
  constructor(private readonly svc: RecommendationsService) {}

  @Get()
  list(
    @AccountId() accountId: string,
    @Param('jobId') jobId: string,
    @Query() q: ListQuery,
  ) {
    return this.svc.listForJob(accountId, jobId, q.limit);
  }
}
