import { Controller, Get, Headers, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AccountMatchGuard } from '../common/account-match.guard';
import { JobDomainService } from './job-domain.service';

/**
 * Jobs API backed by the slice store (drained regional jobs, candidates, applications).
 * Mutations (`POST` / `PATCH`) remain on the monolith until writes are implemented here.
 */
@Controller('slice/pipeline/accounts/:accountId')
@UseGuards(AuthGuard('jwt'), AccountMatchGuard)
export class JobsRestController {
  constructor(private readonly jobs: JobDomainService) {}

  @Get('jobs')
  list(
    @Param('accountId') accountId: string,
    @Headers('authorization') authorization: string | undefined,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const query = JobDomainService.parseListQuery({ q, status, includeArchived, limit, cursor });
    return this.jobs.list(accountId, query, { authorization });
  }

  @Get('jobs/:jobId')
  get(
    @Param('accountId') accountId: string,
    @Param('jobId') jobId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    return this.jobs.get(accountId, jobId, { authorization });
  }
}
