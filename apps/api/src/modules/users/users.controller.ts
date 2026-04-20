import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';
import { AuthUser, CurrentUser } from '../../common/request-context';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('users')
export class UsersController {
  constructor(private readonly db: GlobalPrismaService) {}

  @Get('me/accounts')
  async listMyAccounts(@CurrentUser() user: AuthUser) {
    const memberships = await this.db.membership.findMany({
      where: { userId: user.userId, status: 'ACTIVE' },
      include: { account: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.account.id,
      name: m.account.name,
      slug: m.account.slug,
      region: m.account.region.toLowerCase().replace(/_/g, '-'),
      role: m.role.name,
      joinedAt: m.createdAt,
    }));
  }
}
