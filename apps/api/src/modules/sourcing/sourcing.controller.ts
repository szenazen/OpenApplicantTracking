import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId, AuthUser, CurrentUser } from '../../common/request-context';
import { SourcingService } from './sourcing.service';

class SearchQuery {
  @IsString() @MinLength(1) @MaxLength(200) q!: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

class ImportDto {
  @IsString() source!: string;
  @IsString() externalId!: string;
  @IsOptional() @IsString() jobId?: string;
}

class ListImportsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

@ApiTags('sourcing')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('sourcing')
export class SourcingController {
  constructor(private readonly svc: SourcingService) {}

  @Get('providers')
  providers() {
    return this.svc.listProviders();
  }

  @Get('search')
  search(@Query() q: SearchQuery) {
    return this.svc.search({ query: q.q, source: q.source, limit: q.limit });
  }

  @Post('import')
  import(
    @AccountId() accountId: string,
    @Body() dto: ImportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.import(
      accountId,
      { source: dto.source, externalId: dto.externalId, jobId: dto.jobId },
      user.userId,
    );
  }

  @Get('imports')
  listImports(@AccountId() accountId: string, @Query() q: ListImportsQuery) {
    return this.svc.listImports(accountId, q.limit);
  }
}
