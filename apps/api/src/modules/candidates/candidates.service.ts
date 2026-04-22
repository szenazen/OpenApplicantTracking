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

/**
 * Partial candidate update. Fields omitted are untouched; fields set to
 * `null` on nullable columns are cleared. Skills are deliberately out of
 * scope — those are edited via a dedicated flow to avoid accidentally
 * wiping someone's tag set on a minor inline edit.
 */
export interface UpdateCandidateInput {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  headline?: string | null;
  location?: string | null;
  currentCompany?: string | null;
  currentTitle?: string | null;
  yearsExperience?: number | null;
  summary?: string | null;
}

@Injectable()
export class CandidatesService {
  constructor(private readonly router: RegionRouterService) {}

  /**
   * List candidates for the Candidates page. We enrich each row with:
   *   - `applicationCounts.{total, active}` — active = the candidate has at
   *     least one application whose pipeline status is not HIRED/DROPPED.
   *   - `skills` — flattened (skillId, name, level) tuples for chip rendering.
   *
   * `active` is how recruiters typically scan their pipeline ("who should I
   * follow up with?"), so we surface it as a first-class column.
   */
  async list(accountId: string, query?: { q?: string }) {
    const { client } = await this.router.forAccount(accountId);
    const rows = await client.candidate.findMany({
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
      include: {
        applications: {
          select: { id: true, currentStatus: { select: { category: true } } },
        },
        skills: {
          select: { skillId: true, level: true, skill: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return rows.map(({ applications, skills, ...scalar }) => {
      const total = applications.length;
      const active = applications.filter(
        (a) => a.currentStatus.category !== 'HIRED' && a.currentStatus.category !== 'DROPPED',
      ).length;
      return {
        ...scalar,
        applicationCounts: { total, active },
        skills: skills.map((s) => ({ skillId: s.skillId, level: s.level, name: s.skill.name })),
      };
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

  /**
   * Partial update with an explicit "field was sent" test so clients can
   * pass `null` to clear a nullable column (e.g. remove a phone number)
   * without us mistaking an omitted field for an intent to clear it.
   */
  async update(accountId: string, candidateId: string, input: UpdateCandidateInput) {
    const { client } = await this.router.forAccount(accountId);
    const current = await client.candidate.findFirst({ where: { id: candidateId, accountId } });
    if (!current) throw new NotFoundException('Candidate not found');

    const data: Record<string, unknown> = {};
    const set = <K extends keyof UpdateCandidateInput>(key: K) => {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        data[key as string] = input[key];
      }
    };
    (['firstName', 'lastName'] as const).forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(input, k)) {
        const v = input[k];
        if (typeof v !== 'string' || v.trim().length === 0) {
          // Required columns — never let an empty string clobber a name.
          return;
        }
        data[k] = v.trim();
      }
    });
    (
      ['email', 'phone', 'headline', 'location', 'currentCompany', 'currentTitle', 'summary'] as const
    ).forEach(set);
    if (Object.prototype.hasOwnProperty.call(input, 'yearsExperience')) {
      data.yearsExperience =
        input.yearsExperience === null || input.yearsExperience === undefined
          ? null
          : Math.max(0, Math.round(Number(input.yearsExperience)));
    }
    if (Object.keys(data).length === 0) {
      return client.candidate.findUniqueOrThrow({
        where: { id: candidateId },
        include: { skills: { include: { skill: true } } },
      });
    }
    return client.candidate.update({
      where: { id: candidateId },
      data,
      include: { skills: { include: { skill: true } } },
    });
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
