import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: GlobalPrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(email: string, password: string, displayName: string) {
    const normalized = email.trim().toLowerCase();
    const existing = await this.db.user.findUnique({ where: { email: normalized } });
    if (existing) throw new ConflictException('Email already registered');

    const rounds = this.config.get<number>('auth.bcryptRounds', 10);
    const passwordHash = await bcrypt.hash(password, rounds);

    const user = await this.db.user.create({
      data: {
        email: normalized,
        displayName,
        credentials: { create: { passwordHash } },
      },
    });
    return this.issueTokens(user.id, user.email);
  }

  async login(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    const user = await this.db.user.findUnique({
      where: { email: normalized },
      include: { credentials: true },
    });
    if (!user || !user.credentials) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.credentials.passwordHash);
    if (!ok) {
      await this.db.authCredential.update({
        where: { userId: user.id },
        data: { failedAttempts: { increment: 1 } },
      });
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.db.authCredential.update({
      where: { userId: user.id },
      data: { failedAttempts: 0, lastLoginAt: new Date() },
    });
    return this.issueTokens(user.id, user.email);
  }

  async me(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          include: { account: true, role: true },
        },
      },
    });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      locale: user.locale,
      accounts: user.memberships.map((m) => ({
        id: m.account.id,
        name: m.account.name,
        slug: m.account.slug,
        region: m.account.region.toLowerCase().replace(/_/g, '-'),
        role: m.role.name,
      })),
    };
  }

  private async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync({ sub: userId, email });
    // Store a hashed refresh token in the sessions table.
    const refreshRaw = randomBytes(36).toString('base64url');
    const refreshHash = await bcrypt.hash(refreshRaw, 8);
    const ttlDays = this.parseDays(this.config.get<string>('auth.refreshTtl', '30d'));
    await this.db.session.create({
      data: {
        userId,
        refreshHash,
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
      },
    });
    return {
      accessToken,
      refreshToken: refreshRaw,
      expiresIn: this.config.get<string>('auth.accessTtl', '15m'),
    };
  }

  private parseDays(ttl: string): number {
    const m = ttl.match(/^(\d+)d$/);
    return m ? Number(m[1]) : 30;
  }
}
