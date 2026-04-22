import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AccountGuard } from '../../common/account.guard';
import { AccountId, CurrentUser, type AuthUser } from '../../common/request-context';
import { HomeService } from './home.service';

@ApiTags('home')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('home')
export class HomeController {
  constructor(private readonly svc: HomeService) {}

  /**
   * Aggregated landing-page summary for the active account.
   *
   * Single endpoint by design: the home view always renders the same
   * blocks together, and a single round-trip is significantly faster than
   * 4–5 parallel ones (and easier to test as a snapshot).
   */
  @Get()
  summary(@AccountId() accountId: string, @CurrentUser() user: AuthUser) {
    return this.svc.summary(accountId, user.userId);
  }
}
