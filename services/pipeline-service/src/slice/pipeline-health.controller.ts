import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Liveness + DB touch (no auth). */
@Controller('slice/pipeline')
export class PipelineHealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('verify')
  async verify() {
    const pipelineCount = await this.prisma.pipeline.count();
    return {
      _service: 'pipeline-service',
      db: 'ok',
      pipelineCount,
    };
  }
}
