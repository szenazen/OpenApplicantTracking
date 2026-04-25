import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { PipelineSliceController } from '../src/slice/pipeline-slice.controller';

describe('PipelineSliceController', () => {
  it('verify returns marker count from prisma', async () => {
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [PipelineSliceController],
      providers: [
        {
          provide: PrismaService,
          useValue: { pipelineSliceMarker: { count: async () => 0 } },
        },
      ],
    }).compile();
    const c = mod.get(PipelineSliceController);
    const r = await c.verify();
    expect(r).toMatchObject({ _service: 'pipeline-service', db: 'ok', markerRows: 0 });
  });
});
