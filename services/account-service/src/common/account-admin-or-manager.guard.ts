import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Requires {@link AccountContextGuard} to have run first so `req.ctx.role` is set.
 */
@Injectable()
export class AccountAdminOrManagerGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const role = req.ctx?.role as string | undefined;
    if (role !== 'admin' && role !== 'account_manager') {
      throw new ForbiddenException('Account admin or account manager access required');
    }
    return true;
  }
}
