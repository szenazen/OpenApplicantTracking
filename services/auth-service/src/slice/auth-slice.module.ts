import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthSliceController } from './auth-slice.controller';

/** Same JWT secret + TTL semantics as the backup API (`apps/api`) for interoperability. */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret:
          c.get<string>('JWT_SECRET') ??
          'dev-change-me-please-use-32-chars-minimum!!',
        signOptions: { expiresIn: c.get<string>('JWT_ACCESS_TTL', '15m') },
      }),
    }),
  ],
  controllers: [AuthSliceController],
})
export class AuthSliceModule {}
