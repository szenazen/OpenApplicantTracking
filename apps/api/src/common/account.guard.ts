import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { RegionRouterService } from '../infrastructure/region-router/region-router.service';
import { GlobalPrismaService } from '../infrastructure/prisma/global-prisma.service';

/**
 * Enforces that:
 *   1. the request is authenticated (JWT already populated `req.user`)
 *   2. the caller supplied an active account id (`x-account-id` header or `?accountId=`)
 *   3. the user is a member of that account
 *   4. the region for that account is resolved and pinned on the request ctx
 *
 * Controllers can then use `@AccountId()` / `@CurrentUser()` param decorators.
 */
@Injectable()
export class AccountGuard implements CanActivate {
  constructor(
    private readonly globalDb: GlobalPrismaService,
    private readonly router: RegionRouterService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.userId) throw new UnauthorizedException();

    const accountId =
      (req.headers['x-account-id'] as string | undefined) ??
      (req.query?.accountId as string | undefined);
    if (!accountId) throw new ForbiddenException('Missing x-account-id header');

    const membership = await this.globalDb.membership.findUnique({
      where: { userId_accountId: { userId: user.userId, accountId } },
      include: { role: true },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('Not a member of this account');
    }

    const { region } = await this.router.forAccount(accountId);
    req.ctx = {
      user: { userId: user.userId, email: user.email, displayName: user.displayName },
      accountId,
      region,
      role: membership.role.name,
    };
    return true;
  }
}
