import { Controller, Get } from '@nestjs/common';

/**
 * New paths under /api/slice/auth — only in microservices mode.
 */
@Controller('slice/auth')
export class AuthSliceController {
  @Get('probe')
  probe() {
    return { _service: 'auth-service', state: 'placeholder', dataOwnedByService: true };
  }
}
