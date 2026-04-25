import {
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Injectable,
} from '@nestjs/common';

/**
 * Ensures `x-account-id` header matches `:accountId` route param (monolith parity).
 */
@Injectable()
export class AccountMatchGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ params: { accountId: string }; headers: Record<string, string | undefined> }>();
    const header = req.headers['x-account-id'];
    const param = req.params.accountId;
    if (!header || header !== param) {
      throw new BadRequestException('x-account-id must match account in path');
    }
    return true;
  }
}
