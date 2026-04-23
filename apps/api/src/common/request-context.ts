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
  /** Membership role on the active account (set by AccountGuard). */
  role?: string;
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
    // Passport JwtStrategy.validate() attaches the principal to req.user. We also
    // mirror it onto req.ctx.user so downstream middleware (e.g. AccountGuard)
    // has a single place to read it.
    const principal: AuthUser | undefined = req.ctx?.user ?? req.user;
    if (!principal) throw new Error('CurrentUser used on unauthenticated route');
    req.ctx = req.ctx ?? {};
    req.ctx.user = principal;
    return principal;
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

/** Account membership role name (`admin`, `recruiter`, …). Requires AccountGuard. */
export const MembershipRoleName = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    if (!req.ctx?.role) throw new Error('MembershipRoleName used without AccountGuard');
    return req.ctx.role;
  },
);
