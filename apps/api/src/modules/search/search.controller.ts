import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId } from '../../common/request-context';
import { SearchService } from './search.service';

class SearchQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

@ApiTags('search')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly svc: SearchService) {}

  /**
   * Unified jobs + candidates search for the command palette.
   * Query <2 chars returns an empty result so the client can skip the
   * round-trip entirely while the user is still typing.
   */
  @Get()
  search(@AccountId() accountId: string, @Query() q: SearchQuery) {
    return this.svc.search(accountId, q.q ?? '');
  }
}
