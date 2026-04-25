import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { PipelineHealthController } from '../src/slice/pipeline-health.controller';

describe('PipelineHealthController', () => {
  it('verify returns pipeline count from prisma', async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [PipelineHealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: { pipeline: { count: async () => 0 } },
        },
      ],
    }).compile();
    const c = mod.get(PipelineHealthController);
    const r = await c.verify();
    expect(r).toMatchObject({ _service: 'pipeline-service', db: 'ok', pipelineCount: 0 });
  });
});
