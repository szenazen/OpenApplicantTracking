import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AccountAdminOrManagerGuard } from '../../common/account-admin-or-manager.guard';
import { AccountGuard } from '../../common/account.guard';
import {
  AccountId,
  AuthUser,
  CurrentUser,
  MembershipRoleName,
} from '../../common/request-context';
import { AccountsService } from './accounts.service';

const REGIONS = ['us-east-1', 'eu-west-1', 'ap-southeast-1', 'ap-northeast-1', 'ap-southeast-2'] as const;

class CreateAccountDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @Matches(/^[a-z0-9-]{3,40}$/, { message: 'slug must be lowercase alphanumeric/hyphen 3-40 chars' })
  slug!: string;
  @IsIn(REGIONS as unknown as string[]) region!: (typeof REGIONS)[number];
}

class AddMemberDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(2) role!: string;
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

  /**
   * Account settings: list members (any active member can read).
   */
  @ApiHeader({ name: 'x-account-id', required: true })
  @UseGuards(AccountGuard)
  @Get('current/members')
  listMembers(@AccountId() accountId: string) {
    return this.svc.listMembers(accountId);
  }

  /**
   * Roles allowed when inviting / adding users (admin vs account manager).
   */
  @ApiHeader({ name: 'x-account-id', required: true })
  @UseGuards(AccountGuard, AccountAdminOrManagerGuard)
  @Get('current/assignable-invite-roles')
  assignableInviteRoles(@MembershipRoleName() membershipRole: string) {
    return this.svc.assignableInviteRoles(membershipRole);
  }

  @ApiHeader({ name: 'x-account-id', required: true })
  @UseGuards(AccountGuard, AccountAdminOrManagerGuard)
  @Post('current/members')
  addMember(
    @AccountId() accountId: string,
    @MembershipRoleName() membershipRole: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.svc.addMemberByEmail(accountId, membershipRole, dto.email, dto.role);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getForUser(user.userId, id);
  }
}
