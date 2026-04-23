import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AccountsService } from './accounts.service';
import { AuthUser } from '../auth/auth-user';
import { CurrentUser } from './current-user.decorator';

/**
 * v1 account reads — same JSON shape as the monolith `GET /api/accounts/:id`
 * plus `_service` so clients can confirm routing during strangler migration.
 */
@Controller('accounts')
export class AccountsController {
  constructor(private readonly svc: AccountsService) {}

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getForUser(user.userId, id);
  }
}
