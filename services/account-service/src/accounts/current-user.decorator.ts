import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../auth/auth-user';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest();
  const u = req.user as AuthUser | undefined;
  if (!u) throw new Error('CurrentUser used without JWT auth');
  return u;
});
