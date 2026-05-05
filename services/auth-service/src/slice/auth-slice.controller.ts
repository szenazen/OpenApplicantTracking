import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { VerifyAccessDto } from './verify-access.dto';

/**
 * New paths under /api/slice/auth — routed by Web BFF when `AUTH_SLICE_ENABLED`.
 * Does **not** use the monolith DB; `verify-access` is cryptographic JWT check only (no ACTIVE-user lookup).
 */
@Controller('slice/auth')
export class AuthSliceController {
  constructor(private readonly jwt: JwtService) {}

  @Get('probe')
  probe() {
    return { _service: 'auth-service', state: 'placeholder', dataOwnedByService: true };
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
