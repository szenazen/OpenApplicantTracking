import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AccountMatchGuard } from '../common/account-match.guard';
import { JobDomainService } from './job-domain.service';

/**
 * Jobs index backed by the slice store (minimal rows + applications for counts).
 * `GET /api/jobs/:id` and mutations remain on the monolith until Kanban data lives here.
 */
@Controller('slice/pipeline/accounts/:accountId')
@UseGuards(AuthGuard('jwt'), AccountMatchGuard)
export class JobsRestController {
  constructor(private readonly jobs: JobDomainService) {}

  @Get('jobs')
  list(
    @Param('accountId') accountId: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const query = JobDomainService.parseListQuery({ q, status, includeArchived, limit, cursor });
    return this.jobs.list(accountId, query);
  }
}
