import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The authenticated principal attached to every request.
 */
export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
}

export interface RequestContext {
  user?: AuthUser;
  /** Active account id (from x-account-id header or ?accountId=). */
  accountId?: string;
  /** Region resolved for the active account. */
  region?: string;
}

declare module 'express' {
  interface Request {
    ctx: RequestContext;
  }
}

/** @CurrentUser() — extract the authenticated user in a controller. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.ctx?.user) throw new Error('CurrentUser used on unauthenticated route');
    return req.ctx.user;
  },
);

/** @AccountId() — extract the active account id. Requires AccountGuard. */
export const AccountId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.ctx?.accountId) throw new Error('AccountId used without AccountGuard');
    return req.ctx.accountId;
  },
);
