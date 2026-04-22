import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId, AuthUser, CurrentUser } from '../../common/request-context';
import { JobsService } from './jobs.service';

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'] as const;
const JOB_STATUSES = ['DRAFT', 'PUBLISHED', 'ON_HOLD', 'CLOSED', 'ARCHIVED'] as const;

class CreateJobDto {
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsIn(EMPLOYMENT_TYPES)
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @IsOptional() @IsString() pipelineId?: string;
  @IsOptional() @IsArray() requiredSkillIds?: string[];
}

/**
 * Partial-update DTO. `ValidateIf` + `IsOptional` together let callers
 * send explicit `null` to clear nullable string fields (department,
 * location, description) without tripping the string validator.
 */
class UpdateJobDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(10_000)
  description?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(200)
  department?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(200)
  location?: string | null;
  @IsOptional() @IsIn(EMPLOYMENT_TYPES)
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @IsOptional() @IsIn(JOB_STATUSES)
  status?: (typeof JOB_STATUSES)[number];
  @IsOptional() @IsArray() requiredSkillIds?: string[];
  @IsOptional() @IsString() pipelineId?: string;
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
  get(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.svc.get(accountId, id, user.userId);
  }

  @Post()
  create(@AccountId() accountId: string, @Body() dto: CreateJobDto) {
    return this.svc.create(accountId, dto);
  }

  @Patch(':id')
  update(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
  ) {
    return this.svc.update(accountId, id, dto, user.userId);
  }
}
