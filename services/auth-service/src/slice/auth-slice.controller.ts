import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { LoginShimDto } from './login-shim.dto';
import { MonolithLoginShimService } from './monolith-login-shim.service';
import { VerifyAccessDto } from './verify-access.dto';

/**
 * New paths under /api/slice/auth — routed by Web BFF when `AUTH_SLICE_ENABLED`.
 * Does **not** use the monolith DB; `verify-access` is cryptographic JWT check only (no ACTIVE-user lookup).
 */
@Controller('slice/auth')
export class AuthSliceController {
  constructor(
    private readonly jwt: JwtService,
    private readonly monolithLoginShim: MonolithLoginShimService,
  ) {}

  @Get('probe')
  probe() {
    return { _service: 'auth-service', state: 'placeholder', dataOwnedByService: true };
  }

  /**
   * Strangler shim: **`POST /api/auth/login`** on **`MONOLITH_URL`** when **`AUTH_LOGIN_SHIM`** — BFF
   * sends slice traffic here only when that flag is set (see **`services/web-bff/src/routing.ts`**).
   */
  @Post('login')
  async loginSlice(@Body() dto: LoginShimDto): Promise<unknown> {
    if (!this.monolithLoginShim.isShimEnabled()) {
      throw new ServiceUnavailableException({
        error: 'AUTH_LOGIN_SHIM_disabled',
        detail: 'Enable AUTH_LOGIN_SHIM or call POST /api/auth/login via BFF toward monolith.',
      });
    }
    const out = await this.monolithLoginShim.forwardLogin(dto);
    throw new HttpException(out.body, out.status);
  }

  /** Validate access token signature and expiry against `JWT_SECRET` (same as backup API). */
  @Post('verify-access')
  @HttpCode(200)
  verifyAccess(@Body() dto: VerifyAccessDto):
    | { valid: true; payload: { sub: string; email: string }; _service: 'auth-service' }
    | { valid: false; _service: 'auth-service' } {
    try {
      const payload = this.jwt.verify<{ sub?: string; email?: string }>(dto.accessToken);
      return {
        valid: true,
        payload: {
          sub: typeof payload.sub === 'string' ? payload.sub : '',
          email: typeof payload.email === 'string' ? payload.email : '',
        },
        _service: 'auth-service',
      };
    } catch {
      return { valid: false, _service: 'auth-service' };
    }
  }
}
