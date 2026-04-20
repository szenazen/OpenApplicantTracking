import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

export interface CreateJobInput {
  title: string;
  description?: string;
  department?: string;
  location?: string;
  employmentType?: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP' | 'TEMPORARY';
  pipelineId?: string;
  requiredSkillIds?: string[];
}

@Injectable()
export class JobsService {
  constructor(private readonly router: RegionRouterService) {}

  async list(accountId: string) {
    const { client } = await this.router.forAccount(accountId);
    return client.job.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      include: { pipeline: { include: { statuses: { orderBy: { position: 'asc' } } } } },
    });
  }

  async get(accountId: string, jobId: string) {
    const { client } = await this.router.forAccount(accountId);
    const job = await client.job.findFirst({
      where: { id: jobId, accountId },
      include: {
        pipeline: { include: { statuses: { orderBy: { position: 'asc' } } } },
        applications: {
          include: { candidate: true, currentStatus: true },
          orderBy: [{ currentStatusId: 'asc' }, { position: 'asc' }],
        },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  async create(accountId: string, input: CreateJobInput) {
    const { client } = await this.router.forAccount(accountId);
    let pipelineId = input.pipelineId;
    if (!pipelineId) {
      const defaultPipeline = await client.pipeline.findFirst({
        where: { accountId, isDefault: true },
      });
      if (!defaultPipeline) throw new BadRequestException('No default pipeline and no pipelineId provided');
      pipelineId = defaultPipeline.id;
    }
    return client.job.create({
      data: {
        accountId,
        title: input.title,
        description: input.description,
        department: input.department,
        location: input.location,
        employmentType: input.employmentType ?? 'FULL_TIME',
        pipelineId,
        requiredSkillIds: input.requiredSkillIds ?? [],
        status: 'PUBLISHED',
        openedAt: new Date(),
      },
    });
  }
}
