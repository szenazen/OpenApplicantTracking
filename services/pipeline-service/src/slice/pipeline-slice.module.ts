import { Module } from '@nestjs/common';
import { PipelineSliceController } from './pipeline-slice.controller';

@Module({ controllers: [PipelineSliceController] })
export class PipelineSliceModule {}
