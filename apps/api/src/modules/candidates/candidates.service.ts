import { Injectable, NotFoundException } from '@nestjs/common';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

export interface CreateCandidateInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  headline?: string;
  location?: string;
  currentCompany?: string;
  currentTitle?: string;
  yearsExperience?: number;
  summary?: string;
  source?: string;
  skillIds?: string[];
}

@Injectable()
export class CandidatesService {
  constructor(private readonly router: RegionRouterService) {}

  async list(accountId: string, query?: { q?: string }) {
    const { client } = await this.router.forAccount(accountId);
    return client.candidate.findMany({
      where: {
        accountId,
        ...(query?.q
          ? {
              OR: [
                { firstName: { contains: query.q, mode: 'insensitive' } },
                { lastName: { contains: query.q, mode: 'insensitive' } },
                { email: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async get(accountId: string, candidateId: string) {
    const { client } = await this.router.forAccount(accountId);
    const c = await client.candidate.findFirst({
      where: { id: candidateId, accountId },
      include: { applications: { include: { job: true, currentStatus: true } } },
    });
    if (!c) throw new NotFoundException('Candidate not found');
    return c;
  }

  async create(accountId: string, input: CreateCandidateInput) {
    const { client } = await this.router.forAccount(accountId);
    return client.candidate.create({
      data: { accountId, ...input, skillIds: input.skillIds ?? [] },
    });
  }
}
