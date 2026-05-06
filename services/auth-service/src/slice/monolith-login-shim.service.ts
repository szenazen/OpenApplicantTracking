import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { LoginShimDto } from './login-shim.dto';

@Injectable()
export class MonolithLoginShimService {
  constructor(private readonly config: ConfigService) {}

  isShimEnabled(): boolean {
    const v = this.config.get<string>('AUTH_LOGIN_SHIM') ?? process.env.AUTH_LOGIN_SHIM;
    return v === '1' || v === 'true';
  }

  /**
   * Forwards credentials to **`apps/api`** `POST /api/auth/login` (strangler shim).
   */
  async forwardLogin(dto: LoginShimDto): Promise<{ status: number; body: unknown }> {
    const raw =
      this.config.get<string>('MONOLITH_URL') ?? process.env.MONOLITH_URL ?? 'http://127.0.0.1:3001';
    const base = raw.replace(/\/$/, '');
    const url = `${base}/api/auth/login`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email: dto.email, password: dto.password }),
      });
    } catch {
      throw new BadGatewayException({ error: 'monolith_unreachable', target: url });
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* leave as string */
    }
    return { status: res.status, body };
  }
}
