import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';
import { AuthUser } from '../../common/request-context';

interface JwtPayload {
  sub: string; // userId
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly globalDb: GlobalPrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('auth.jwtSecret'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.globalDb.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, displayName: true, status: true },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Invalid session');
    return { userId: user.id, email: user.email, displayName: user.displayName };
  }
}
