import { Injectable, NotFoundException } from '@nestjs/common';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

export interface SkillRef {
  id: string;
  name: string;
}

export interface RecommendedCandidate {
  candidate: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    headline: string | null;
    location: string | null;
    currentCompany: string | null;
    currentTitle: string | null;
    yearsExperience: number | null;
    updatedAt: Date;
  };
  score: number;
  matchedSkills: SkillRef[];
  missingSkills: SkillRef[];
}

export interface RecommendationsResponse {
  jobId: string;
  requiredSkills: SkillRef[];
  candidates: RecommendedCandidate[];
}

/**
 * Candidate recommendations for a job, scored by skill overlap.
 *
 * The ranking is intentionally explainable (and debuggable) rather than a
 * black-box ML score:
 *   - score = number of the job's required skills that the candidate has.
 *   - ties broken by candidate's most recent update (fresher profile first).
 *
 * We exclude candidates who already have an application on this job so the
 * tab surfaces only actionable suggestions. When the job has no required
 * skills we return an empty list — there's nothing to overlap against and
 * a noisy "everyone matches" list would be worse than none.
 */
@Injectable()
export class RecommendationsService {
  constructor(private readonly router: RegionRouterService) {}

  async listForJob(accountId: string, jobId: string, limit = 20): Promise<RecommendationsResponse> {
    const take = Math.max(1, Math.min(100, limit));
    const { client } = await this.router.forAccount(accountId);

    const job = await client.job.findFirst({
      where: { id: jobId, accountId },
      select: { id: true, requiredSkillIds: true },
    });
    if (!job) throw new NotFoundException('Job not found');

    const requiredIds = job.requiredSkillIds ?? [];
    const requiredSkills = requiredIds.length
      ? await client.skillCache.findMany({
          where: { id: { in: requiredIds } },
          select: { id: true, name: true },
        })
      : [];

    if (requiredIds.length === 0) {
      return { jobId: job.id, requiredSkills: [], candidates: [] };
    }

    // Pull every (candidate, matched-required-skill) pair in one query. The
    // join depth is small: we only care about candidates in this account
    // who (a) hold at least one of the required skills, and (b) don't
    // already have an application on this job.
    const matches = await client.candidateSkill.findMany({
      where: {
        skillId: { in: requiredIds },
        candidate: {
          accountId,
          applications: { none: { jobId } },
        },
      },
      include: {
        candidate: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            headline: true,
            location: true,
            currentCompany: true,
            currentTitle: true,
            yearsExperience: true,
            updatedAt: true,
          },
        },
        skill: { select: { id: true, name: true } },
      },
    });

    const requiredMap = new Map(requiredSkills.map((s) => [s.id, s]));

    interface Aggregate {
      candidate: RecommendedCandidate['candidate'];
      matched: Map<string, SkillRef>;
    }
    const byCandidate = new Map<string, Aggregate>();
    for (const m of matches) {
      const entry =
        byCandidate.get(m.candidateId) ?? { candidate: m.candidate, matched: new Map<string, SkillRef>() };
      entry.matched.set(m.skillId, requiredMap.get(m.skillId) ?? m.skill);
      byCandidate.set(m.candidateId, entry);
    }

    const ranked: RecommendedCandidate[] = Array.from(byCandidate.values())
      .map((agg) => {
        const matchedSkills = Array.from(agg.matched.values());
        const missingSkills = requiredSkills.filter((s) => !agg.matched.has(s.id));
        return {
          candidate: agg.candidate,
          score: matchedSkills.length,
          matchedSkills,
          missingSkills,
        };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.candidate.updatedAt.getTime() - a.candidate.updatedAt.getTime();
      })
      .slice(0, take);

    return { jobId: job.id, requiredSkills, candidates: ranked };
  }
}
