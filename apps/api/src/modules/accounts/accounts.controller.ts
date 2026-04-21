import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AccountsService } from './accounts.service';
import { AccountGuard } from '../../common/account.guard';
import { AccountId, AuthUser, CurrentUser } from '../../common/request-context';

const REGIONS = ['us-east-1', 'eu-west-1', 'ap-southeast-1', 'ap-northeast-1', 'ap-southeast-2'] as const;

class CreateAccountDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @Matches(/^[a-z0-9-]{3,40}$/, { message: 'slug must be lowercase alphanumeric/hyphen 3-40 chars' })
  slug!: string;
  @IsIn(REGIONS as unknown as string[]) region!: (typeof REGIONS)[number];
}

@ApiTags('accounts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('accounts')
export class AccountsController {
  constructor(private readonly svc: AccountsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.svc.create({ ownerUserId: user.userId, ...dto });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getForUser(user.userId, id);
  }

  /**
   * List the active members of the caller's current account. Requires
   * AccountGuard so it works against `x-account-id` rather than the path
   * (consistent with every other account-scoped read).
   */
  @ApiHeader({ name: 'x-account-id', required: true })
  @UseGuards(AccountGuard)
  @Get('current/members')
  listMembers(@AccountId() accountId: string) {
    return this.svc.listMembers(accountId);
  }
}
