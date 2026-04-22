import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId, AuthUser, CurrentUser } from '../../common/request-context';
import { JobsService, JobStatus as JobStatusType } from './jobs.service';

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'] as const;
const JOB_STATUSES = ['DRAFT', 'PUBLISHED', 'ON_HOLD', 'CLOSED', 'ARCHIVED'] as const;

class CreateJobDto {
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() @MaxLength(200) clientName?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10_000) headCount?: number;
  @IsOptional() @IsIn(EMPLOYMENT_TYPES)
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @IsOptional() @IsString() pipelineId?: string;
  @IsOptional() @IsArray() requiredSkillIds?: string[];
  @IsOptional() @IsString() ownerId?: string;
}

/**
 * Partial-update DTO. `ValidateIf` + `IsOptional` together let callers
 * send explicit `null` to clear nullable string fields (department,
 * location, description, clientName) without tripping the string validator.
 */
class UpdateJobDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(10_000)
  description?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(200)
  department?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(200)
  location?: string | null;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() @MaxLength(200)
  clientName?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(10_000) headCount?: number;
  @IsOptional() @IsIn(EMPLOYMENT_TYPES)
  employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @IsOptional() @IsIn(JOB_STATUSES)
  status?: (typeof JOB_STATUSES)[number];
  @IsOptional() @IsArray() requiredSkillIds?: string[];
  @IsOptional() @IsString() pipelineId?: string;
  @ValidateIf((_, v) => v !== null) @IsOptional() @IsString() ownerId?: string | null;
}

@ApiTags('jobs')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('jobs')
export class JobsController {
  constructor(private readonly svc: JobsService) {}

  /**
   * Paginated + filtered jobs index. All query params are optional; with
   * no params the endpoint returns the first 50 non-archived jobs newest
   * first. Pagination is keyset via an opaque `cursor`.
   */
  @Get()
  list(
    @AccountId() accountId: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    let parsedStatus: JobStatusType | undefined;
    if (status !== undefined && status !== '') {
      if (!JOB_STATUSES.includes(status as (typeof JOB_STATUSES)[number])) {
        throw new BadRequestException(
          `status must be one of: ${JOB_STATUSES.join(', ')}`,
        );
      }
      parsedStatus = status as JobStatusType;
    }

    let parsedLimit: number | undefined;
    if (limitRaw !== undefined && limitRaw !== '') {
      const n = Number(limitRaw);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 100) {
        throw new BadRequestException('limit must be an integer between 1 and 100');
      }
      parsedLimit = n;
    }

    const parsedIncludeArchived = parseOptionalBool(includeArchived, 'includeArchived');

    return this.svc.list(accountId, {
      q,
      status: parsedStatus,
      includeArchived: parsedIncludeArchived,
      limit: parsedLimit,
      cursor: cursor || undefined,
    });
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
  create(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateJobDto,
  ) {
    return this.svc.create(accountId, dto, user.userId);
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

/**
 * Parse an optional boolean-ish query parameter. Accepts `true` / `false`
 * (case-insensitive); anything else raises a 400. Returns `undefined` when
 * the value is omitted or empty, so callers can distinguish "not set" from
 * an explicit false.
 */
function parseOptionalBool(raw: string | undefined, name: string): boolean | undefined {
  if (raw === undefined || raw === '') return undefined;
  const v = raw.toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new BadRequestException(`${name} must be "true" or "false"`);
}
