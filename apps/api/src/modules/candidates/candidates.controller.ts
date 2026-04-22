import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId } from '../../common/request-context';
import { CandidatesService } from './candidates.service';

class CandidateSkillDto {
  @IsString() @MinLength(1) skillId!: string;
  /** Self-assessed 1..5 proficiency; null/undefined = unscored. */
  @IsOptional() @IsInt() @Min(1) @Max(5) level?: number | null;
}

class CreateCandidateDto {
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() headline?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() currentCompany?: string;
  @IsOptional() @IsString() currentTitle?: string;
  @IsOptional() @IsInt() @Min(0) yearsExperience?: number;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) skillIds?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CandidateSkillDto)
  skills?: CandidateSkillDto[];
}

/**
 * Partial update DTO. Omitted fields are untouched. Explicit `null` on a
 * nullable column clears it. `@IsOptional()` already short-circuits all
 * other validators when the value is null/undefined, so we can keep the
 * decorators tidy.
 */
class UpdateCandidateDto {
  @IsOptional() @IsString() @MinLength(1) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) lastName?: string;
  @IsOptional() @IsEmail() email?: string | null;
  @IsOptional() @IsString() phone?: string | null;
  @IsOptional() @IsString() headline?: string | null;
  @IsOptional() @IsString() location?: string | null;
  @IsOptional() @IsString() currentCompany?: string | null;
  @IsOptional() @IsString() currentTitle?: string | null;
  @IsOptional() @IsInt() @Min(0) yearsExperience?: number | null;
  @IsOptional() @IsString() summary?: string | null;
}

@ApiTags('candidates')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly svc: CandidatesService) {}

  /**
   * Paginated candidate list with keyset cursor + optional filters.
   *
   * Query params (all optional):
   *   - q        : substring match across name/email/title/company/headline/location
   *   - skillIds : CSV of skill ids; candidate must have ALL of them (AND)
   *   - hasActive: "true" | "false" — has / has not any non-terminal application
   *   - minYoe, maxYoe : inclusive bounds on yearsExperience (non-null only)
   *   - limit    : 1..100, default 50
   *   - cursor   : opaque keyset cursor returned in the previous response
   *
   * Returns `{ items, nextCursor }`. `nextCursor === null` means end of list.
   */
  @Get()
  list(
    @AccountId() accountId: string,
    @Query('q') q?: string,
    @Query('skillIds') skillIdsCsv?: string,
    @Query('hasActive') hasActive?: string,
    @Query('minYoe') minYoeRaw?: string,
    @Query('maxYoe') maxYoeRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const skillIds = skillIdsCsv
      ? skillIdsCsv
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    if (skillIds && skillIds.length > 20) {
      throw new BadRequestException('skillIds cannot contain more than 20 ids');
    }

    const activeFlag =
      hasActive === undefined || hasActive === ''
        ? undefined
        : hasActive === 'true'
          ? true
          : hasActive === 'false'
            ? false
            : (() => {
                throw new BadRequestException('hasActive must be "true" or "false"');
              })();

    const minYoe = parseOptionalNonNegativeInt(minYoeRaw, 'minYoe');
    const maxYoe = parseOptionalNonNegativeInt(maxYoeRaw, 'maxYoe');
    if (minYoe !== undefined && maxYoe !== undefined && minYoe > maxYoe) {
      throw new BadRequestException('minYoe cannot be greater than maxYoe');
    }

    const limit = parseOptionalNonNegativeInt(limitRaw, 'limit');

    return this.svc.list(accountId, {
      q,
      skillIds,
      hasActive: activeFlag,
      minYoe,
      maxYoe,
      limit,
      cursor,
    });
  }

  @Get(':id')
  get(@AccountId() accountId: string, @Param('id') id: string) {
    return this.svc.get(accountId, id);
  }

  @Post()
  create(@AccountId() accountId: string, @Body() dto: CreateCandidateDto) {
    return this.svc.create(accountId, dto);
  }

  /**
   * Partial update from the candidate drawer's inline-edit mode. We keep
   * skill edits in a separate flow so drawer edits can never silently
   * wipe a candidate's tag set — that would be a painful regression.
   */
  @Patch(':id')
  update(@AccountId() accountId: string, @Param('id') id: string, @Body() dto: UpdateCandidateDto) {
    return this.svc.update(accountId, id, dto);
  }
}

/**
 * Parse an optional query param as a non-negative integer. Returns
 * `undefined` when absent. Throws a 400 on malformed input so clients
 * get actionable feedback instead of silent filtering changes.
 */
function parseOptionalNonNegativeInt(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new BadRequestException(`${name} must be a non-negative integer`);
  }
  return n;
}
