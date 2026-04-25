import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * New surface only used in microservices mode (BFF routes /api/slice/pipeline/*).
 * apps/api monolith does not expose these paths.
 */
@Controller('slice/pipeline')
export class PipelineSliceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('verify')
  async verify() {
    const count = await this.prisma.pipelineSliceMarker.count();
    return {
      _service: 'pipeline-service',
      db: 'ok',
      markerRows: count,
    };
  }
}
