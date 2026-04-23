import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AccountAdminOrManagerGuard } from '../common/account-admin-or-manager.guard';
import { AccountContextGuard } from '../common/account-context.guard';
import { AccountId, AuthUser, CurrentUser, MembershipRoleName } from '../common/request-context';
import { AccountsService } from './accounts.service';

class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  role!: string;
}

/**
 * Account reads and membership management — same JSON shapes as the monolith under `/api`.
 * `GET :id` includes `_service` for strangler routing checks.
 */
@Controller('accounts')
export class AccountsController {
  constructor(private readonly svc: AccountsService) {}

  @Get('current/members')
  @UseGuards(AuthGuard('jwt'), AccountContextGuard)
  listMembers(@AccountId() accountId: string) {
    return this.svc.listMembers(accountId);
  }

  @Get('current/assignable-invite-roles')
  @UseGuards(AuthGuard('jwt'), AccountContextGuard, AccountAdminOrManagerGuard)
  assignableInviteRoles(@MembershipRoleName() membershipRole: string) {
    return this.svc.assignableInviteRoles(membershipRole);
  }

  @Post('current/members')
  @UseGuards(AuthGuard('jwt'), AccountContextGuard, AccountAdminOrManagerGuard)
  addMember(
    @AccountId() accountId: string,
    @MembershipRoleName() membershipRole: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.svc.addMemberByEmail(accountId, membershipRole, dto.email, dto.role);
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getForUser(user.userId, id);
  }
}
