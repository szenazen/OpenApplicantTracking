import { Controller, Get, Param, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId } from '../../common/request-context';
import { ReportsService } from './reports.service';

class JobReportQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}

@ApiTags('reports')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('jobs/:jobId/reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Get('export')
  async exportCsv(
    @AccountId() accountId: string,
    @Param('jobId') jobId: string,
    @Query() q: JobReportQuery,
  ) {
    const csv = await this.svc.csvForJob(accountId, jobId, { windowDays: q.days });
    const buf = Buffer.from(csv, 'utf-8');
    return new StreamableFile(buf, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="job-${jobId}-report.csv"`,
    });
  }

  @Get()
  forJob(
    @AccountId() accountId: string,
    @Param('jobId') jobId: string,
    @Query() q: JobReportQuery,
  ) {
    return this.svc.forJob(accountId, jobId, { windowDays: q.days });
  }
}
