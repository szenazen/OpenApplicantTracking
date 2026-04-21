import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';
import { ReactionsService } from '../reactions/reactions.service';

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
  constructor(
    private readonly router: RegionRouterService,
    private readonly reactions: ReactionsService,
  ) {}

  async list(accountId: string) {
    const { client } = await this.router.forAccount(accountId);
    return client.job.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      include: { pipeline: { include: { statuses: { orderBy: { position: 'asc' } } } } },
    });
  }

  /**
   * Full job payload with all applications, each enriched with:
   *   - `commentCount` — number of non-deleted HR/hiring-manager comments
   *   - `reactionSummary` — counts per kind + the requester's own reactions
   * so the Kanban can render comment + reaction badges without extra RTTs.
   */
  async get(accountId: string, jobId: string, requesterUserId: string) {
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

    const appIds = job.applications.map((a) => a.id);
    const [commentCounts, reactionByApp] = await Promise.all([
      appIds.length
        ? client.applicationComment.groupBy({
            by: ['applicationId'],
            where: { accountId, applicationId: { in: appIds }, deletedAt: null },
            _count: { _all: true },
          })
        : Promise.resolve([] as Array<{ applicationId: string; _count: { _all: number } }>),
      this.reactions.summarizeMany(accountId, appIds, requesterUserId),
    ]);
    const commentCountByApp = new Map(commentCounts.map((c) => [c.applicationId, c._count._all] as const));

    const applications = job.applications.map((a) => ({
      ...a,
      commentCount: commentCountByApp.get(a.id) ?? 0,
      reactionSummary: reactionByApp.get(a.id) ?? { counts: { THUMBS_UP: 0, THUMBS_DOWN: 0, STAR: 0 }, myReactions: [] },
    }));

    return { ...job, applications };
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
