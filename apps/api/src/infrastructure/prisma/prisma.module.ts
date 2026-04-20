import { Global, Module } from '@nestjs/common';
import { GlobalPrismaService } from './global-prisma.service';

@Global()
@Module({
  providers: [GlobalPrismaService],
  exports: [GlobalPrismaService],
})
export class PrismaModule {}
