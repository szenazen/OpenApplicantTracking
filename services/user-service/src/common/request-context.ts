import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
}

export interface RequestContext {
  user?: AuthUser;
}

declare module 'express' {
  interface Request {
    ctx?: RequestContext;
  }
}

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
