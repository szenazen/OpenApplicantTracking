import { Injectable } from '@nestjs/common';
import { PipelinesPrismaService } from './pipelines-prisma.service';
import { PipelinesSliceClientService } from './pipelines-slice-client.service';

function useSlice(): boolean {
  return process.env.OAT_USE_PIPELINE_SLICE === '1' || process.env.OAT_USE_PIPELINE_SLICE === 'true';
}

/**
 * When `OAT_USE_PIPELINE_SLICE=true`, pipeline CRUD is delegated to
 * `PIPELINE_SLICE_BASE_URL` (see @oat/pipeline-service). Default: regional Prisma.
 */
@Injectable()
export class PipelinesService {
  constructor(
    private readonly prisma: PipelinesPrismaService,
    private readonly slice: PipelinesSliceClientService,
  ) {}

  list(accountId: string, authHeader?: string) {
    if (useSlice()) return this.slice.list(accountId, authHeader) as ReturnType<PipelinesPrismaService['list']>;
    return this.prisma.list(accountId);
  }

  get(accountId: string, pipelineId: string, authHeader?: string) {
    if (useSlice()) return this.slice.get(accountId, pipelineId, authHeader) as ReturnType<PipelinesPrismaService['get']>;
    return this.prisma.get(accountId, pipelineId);
  }

  create(
    accountId: string,
    name: string,
    statuses: { name: string; color?: string; category?: string }[],
    authHeader?: string,
  ) {
    if (useSlice()) {
      return this.slice.create(accountId, name, statuses, authHeader) as ReturnType<PipelinesPrismaService['create']>;
    }
    return this.prisma.create(accountId, name, statuses);
  }

  addStatus(
    accountId: string,
    pipelineId: string,
    input: { name: string; color?: string; category?: string; position?: number },
    authHeader?: string,
  ) {
    if (useSlice()) {
      return this.slice.addStatus(accountId, pipelineId, input, authHeader) as ReturnType<PipelinesPrismaService['addStatus']>;
    }
    return this.prisma.addStatus(accountId, pipelineId, input);
  }

  reorderStatuses(accountId: string, pipelineId: string, orderedStatusIds: string[], authHeader?: string) {
    if (useSlice()) {
      return this.slice.reorderStatuses(accountId, pipelineId, orderedStatusIds, authHeader) as ReturnType<
        PipelinesPrismaService['reorderStatuses']
      >;
    }
    return this.prisma.reorderStatuses(accountId, pipelineId, orderedStatusIds);
  }

  removeStatus(accountId: string, pipelineId: string, statusId: string, authHeader?: string) {
    if (useSlice()) {
      return this.slice.removeStatus(accountId, pipelineId, statusId, authHeader) as ReturnType<PipelinesPrismaService['removeStatus']>;
    }
    return this.prisma.removeStatus(accountId, pipelineId, statusId);
  }
}
