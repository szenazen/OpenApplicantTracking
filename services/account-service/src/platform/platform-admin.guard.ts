import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly db: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId as string | undefined;
    if (!userId) throw new UnauthorizedException();

    const row = await this.db.user.findUnique({
      where: { id: userId },
      select: { platformAdmin: true },
    });
    if (!row?.platformAdmin) {
      throw new ForbiddenException('Platform administrator access required');
    }
    return true;
  }
}
