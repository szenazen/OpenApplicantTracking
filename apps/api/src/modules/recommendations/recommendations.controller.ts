import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId } from '../../common/request-context';
import { RecommendationsService } from './recommendations.service';

/**
 * Query DTO for recommendations. `skillIds` ships as a CSV so we stay
 * transport-friendly; we parse it in the controller and pass a real
 * string[] to the service.
 */
class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() skillIds?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(80) minYoe?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(80) maxYoe?: number;
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
    if (
      typeof q.minYoe === 'number' &&
      typeof q.maxYoe === 'number' &&
      q.minYoe > q.maxYoe
    ) {
      throw new BadRequestException('minYoe cannot exceed maxYoe');
    }
    const skillIds = q.skillIds
      ? q.skillIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    return this.svc.listForJob(accountId, jobId, {
      limit: q.limit,
      q: q.q,
      location: q.location,
      skillIds,
      minYoe: q.minYoe,
      maxYoe: q.maxYoe,
    });
  }
}
