import { Injectable, NotFoundException } from '@nestjs/common';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

/** Input shape for a skill on a candidate — mirrors CANDIDATE_SKILLS(skill_id, level). */
export interface CandidateSkillInput {
  skillId: string;
  level?: number | null;
}

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
  /** Structured skills (preferred). */
  skills?: CandidateSkillInput[];
  /** Back-compat: flat list of skill ids, written with level=null. */
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
      include: {
        applications: { include: { job: true, currentStatus: true } },
        skills: { include: { skill: true } },
      },
    });
    if (!c) throw new NotFoundException('Candidate not found');
    return c;
  }

  async create(accountId: string, input: CreateCandidateInput) {
    const { client } = await this.router.forAccount(accountId);
    const { skills, skillIds, ...scalar } = input;
    // Merge the two inputs — `skills` wins; stray `skillIds` fill in with null level.
    const normalized = dedupeSkills([
      ...(skills ?? []),
      ...((skillIds ?? []).map((id) => ({ skillId: id, level: null }))),
    ]);

    return client.$transaction(async (tx) => {
      const created = await tx.candidate.create({ data: { accountId, ...scalar } });
      if (normalized.length) {
        await tx.candidateSkill.createMany({
          data: normalized.map((s) => ({
            candidateId: created.id,
            skillId: s.skillId,
            level: s.level ?? null,
          })),
          skipDuplicates: true,
        });
      }
      return tx.candidate.findUniqueOrThrow({
        where: { id: created.id },
        include: { skills: { include: { skill: true } } },
      });
    });
  }
}

function dedupeSkills(items: CandidateSkillInput[]): CandidateSkillInput[] {
  const seen = new Map<string, CandidateSkillInput>();
  for (const s of items) {
    if (!s.skillId) continue;
    const prior = seen.get(s.skillId);
    // If we already have this skill with a level, keep it; otherwise overwrite.
    if (prior && prior.level != null) continue;
    seen.set(s.skillId, s);
  }
  return Array.from(seen.values());
}
