import { Module } from '@nestjs/common';
import { AuthSliceController } from './auth-slice.controller';

@Module({ controllers: [AuthSliceController] })
export class AuthSliceModule {}
