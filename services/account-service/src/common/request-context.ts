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
  /** Membership role on the active account (set by AccountContextGuard). */
  role?: string;
}

declare module 'express' {
  interface Request {
    ctx?: RequestContext;
  }
}

/** @CurrentUser() — extract the authenticated user in a controller. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    const principal: AuthUser | undefined = req.ctx?.user ?? req.user;
    if (!principal) throw new Error('CurrentUser used on unauthenticated route');
    req.ctx = req.ctx ?? {};
    req.ctx.user = principal;
    return principal;
  },
);

/** @AccountId() — extract the active account id. Requires AccountContextGuard. */
export const AccountId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.ctx?.accountId) throw new Error('AccountId used without AccountContextGuard');
    return req.ctx.accountId;
  },
);

/** Account membership role name (`admin`, `recruiter`, …). Requires AccountContextGuard. */
export const MembershipRoleName = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.ctx?.role) throw new Error('MembershipRoleName used without AccountContextGuard');
    return req.ctx.role;
  },
);
