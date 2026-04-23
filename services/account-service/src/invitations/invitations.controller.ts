import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AccountAdminOrManagerGuard } from '../common/account-admin-or-manager.guard';
import { AccountContextGuard } from '../common/account-context.guard';
import { AccountId, AuthUser, CurrentUser, MembershipRoleName } from '../common/request-context';
import { InvitationsService } from './invitations.service';

class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  role!: string;
}

@UseGuards(AuthGuard('jwt'), AccountContextGuard, AccountAdminOrManagerGuard)
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly svc: InvitationsService) {}

  @Get()
  list(@AccountId() accountId: string) {
    return this.svc.listPending(accountId);
  }

  @Post()
  create(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @MembershipRoleName() membershipRole: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.svc.create(accountId, user.userId, membershipRole, dto.email, dto.role);
  }

  @Delete(':id')
  revoke(@AccountId() accountId: string, @Param('id') id: string) {
    return this.svc.revoke(accountId, id);
  }
}
