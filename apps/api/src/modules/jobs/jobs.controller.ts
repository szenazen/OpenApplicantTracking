import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId } from '../../common/request-context';
import { JobsService } from './jobs.service';

class CreateJobDto {
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsIn(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'])
  employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'TEMPORARY';
  @IsOptional() @IsString() pipelineId?: string;
  @IsOptional() @IsArray() requiredSkillIds?: string[];
}

@ApiTags('jobs')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly svc: JobsService) {}

  @Get()
  list(@AccountId() accountId: string) {
    return this.svc.list(accountId);
  }

  @Get(':id')
  get(@AccountId() accountId: string, @Param('id') id: string) {
    return this.svc.get(accountId, id);
  }

  @Post()
  create(@AccountId() accountId: string, @Body() dto: CreateJobDto) {
    return this.svc.create(accountId, dto);
  }
}
