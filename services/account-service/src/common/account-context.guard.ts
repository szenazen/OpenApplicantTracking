import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Like the monolith {@link AccountGuard} but **global-DB only**: verifies JWT,
 * `x-account-id`, and active membership. Does **not** call RegionRouterService.
 */
@Injectable()
export class AccountContextGuard implements CanActivate {
  constructor(private readonly db: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.userId) throw new UnauthorizedException();

    const accountId =
      (req.headers['x-account-id'] as string | undefined) ??
      (req.query?.accountId as string | undefined);
    if (!accountId) throw new ForbiddenException('Missing x-account-id header');

    const membership = await this.db.membership.findUnique({
      where: { userId_accountId: { userId: user.userId, accountId } },
      include: { role: true },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('Not a member of this account');
    }

    req.ctx = {
      user: { userId: user.userId, email: user.email, displayName: user.displayName },
      accountId,
      role: membership.role.name,
    };
    return true;
  }
}
