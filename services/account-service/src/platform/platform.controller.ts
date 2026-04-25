import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformService } from './platform.service';

@UseGuards(AuthGuard('jwt'), PlatformAdminGuard)
@Controller('platform')
export class PlatformController {
  constructor(private readonly svc: PlatformService) {}

  @Get('accounts')
  listAccounts() {
    return this.svc.listAccounts();
  }
}
