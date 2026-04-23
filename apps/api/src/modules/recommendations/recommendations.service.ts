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
  /**
   * Raw count of matched required skills. Kept for backwards compatibility
   * and for recruiters who want the bare "n of N" number.
   */
  score: number;
  /**
   * Multi-signal overall match percentage (0-100). This is the number the
   * UI should show as the headline "match %" badge.
   */
  scorePct: number;
  /** Per-signal breakdown in percentage points, plus weights used. */
  breakdown: {
    skillsPct: number;
    locationPct: number;
    titlePct: number;
    freshnessPct: number;
    yoePct: number | null;
    weights: {
      skills: number;
      location: number;
      title: number;
      freshness: number;
      yoe: number;
    };
  };
  /** Human-readable bullet points explaining the score. */
  reasons: string[];
  matchedSkills: SkillRef[];
  missingSkills: SkillRef[];
}

export interface RecommendationsResponse {
  jobId: string;
  requiredSkills: SkillRef[];
  candidates: RecommendedCandidate[];
}

export interface RecommendationsQuery {
  limit?: number;
  /** Free text search — name / headline / currentTitle / currentCompany. */
  q?: string;
  /** Narrow to candidates holding ALL of these skill ids (intersection). */
  skillIds?: string[];
  /** Years-of-experience filters, inclusive. */
  minYoe?: number;
  maxYoe?: number;
  /** Substring location filter applied on the candidate side. */
  location?: string;
}

/**
 * Candidate recommendations for a job.
 *
 * We moved from a single-signal (skill-overlap) ranker to a small,
 * explainable multi-signal scorer so results match what recruiters
 * actually act on (YoE + skills + location + title + recency):
 *
 *   scorePct = Σ weight_i · signal_i · 100
 *
 * Default weights (Σ = 1):
 *   yoe       0.34   — seniority fit leads the blend (stronger than skill overlap alone)
 *   skills    0.28   — required-skill coverage (still core, secondary to YoE)
 *   location  0.18   — sourcing radius
 *   title     0.15   — token overlap with the job title
 *   freshness 0.05   — nudges recently updated profiles
 *
 * Tie-breaking keeps the old behaviour: more matched required skills,
 * then fresher updatedAt. The raw `score` field (matched-skill count)
 * stays in the payload so any consumer that liked the old ordering has
 * a monotonic number to sort by.
 *
 * Notes:
 *   - We never fabricate a score. If a signal is missing on the profile
 *     (e.g. no location) we just zero it — tuning the penalty on missing
 *     data lives in the weights. YoE is excluded from the denominator
 *     when the candidate reports no YoE so we don't penalize candidates
 *     whose profile is silent on seniority.
 *   - We exclude candidates who already have an application on this job
 *     so the tab only surfaces actionable suggestions.
 *   - When the job has no required skills we still search by location /
 *     title / YoE filters supplied by the recruiter — "this is how you
 *     discover candidates even without structured skills".
 */
@Injectable()
export class RecommendationsService {
  // Tunable. Kept as instance readonlys so they're trivially swappable in tests.
  static readonly WEIGHTS = {
    yoe: 0.34,
    skills: 0.28,
    location: 0.18,
    title: 0.15,
    freshness: 0.05,
  };
  /** Freshness half-life in days. Beyond this the contribution is tiny. */
  private static readonly FRESHNESS_HALF_LIFE_DAYS = 60;

  constructor(private readonly router: RegionRouterService) {}

  async listForJob(
    accountId: string,
    jobId: string,
    query: RecommendationsQuery = {},
  ): Promise<RecommendationsResponse> {
    const take = Math.max(1, Math.min(100, query.limit ?? 25));
    const { client } = await this.router.forAccount(accountId);

    const job = await client.job.findFirst({
      where: { id: jobId, accountId },
      select: {
        id: true,
        title: true,
        location: true,
        requiredSkillIds: true,
      },
    });
    if (!job) throw new NotFoundException('Job not found');

    const requiredIds = job.requiredSkillIds ?? [];
    const requiredSkills = requiredIds.length
      ? await client.skillCache.findMany({
          where: { id: { in: requiredIds } },
          select: { id: true, name: true },
        })
      : [];

    // When the job has no required skills AND the caller hasn't asked for
    // anything specific, return an empty list. Anonymous "everyone matches"
    // noise is worse than no recommendations (and this preserves the
    // original behaviour for unchanged callers). As soon as the user
    // applies a filter we fall through and honour it.
    const hasActiveFilter = Boolean(
      (query.q && query.q.trim()) ||
        (query.location && query.location.trim()) ||
        (query.skillIds && query.skillIds.length > 0) ||
        typeof query.minYoe === 'number' ||
        typeof query.maxYoe === 'number',
    );
    if (requiredIds.length === 0 && !hasActiveFilter) {
      return { jobId: job.id, requiredSkills: [], candidates: [] };
    }

    // ----- Candidate pool selection -------------------------------------
    //
    // We start broad: every candidate in the account who isn't already on
    // this job. We then layer the caller's filters (q / skillIds / yoe /
    // location) as WHERE clauses. If the job has required skills we also
    // require at least one overlap — otherwise the list would fill with
    // zero-skill noise that the recruiter would only reject. Callers who
    // want "everyone" can set `skillIds` explicitly.
    const skillIntersection = (query.skillIds ?? []).filter(Boolean);
    const where: Record<string, unknown> = {
      accountId,
      applications: { none: { jobId } },
    };
    const AND: Array<Record<string, unknown>> = [];

    if (query.q) {
      const q = query.q.trim();
      if (q.length > 0) {
        AND.push({
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { headline: { contains: q, mode: 'insensitive' } },
            { currentTitle: { contains: q, mode: 'insensitive' } },
            { currentCompany: { contains: q, mode: 'insensitive' } },
          ],
        });
      }
    }
    if (query.location && query.location.trim().length > 0) {
      AND.push({ location: { contains: query.location.trim(), mode: 'insensitive' } });
    }
    if (typeof query.minYoe === 'number') {
      AND.push({ yearsExperience: { gte: query.minYoe } });
    }
    if (typeof query.maxYoe === 'number') {
      AND.push({ yearsExperience: { lte: query.maxYoe } });
    }
    // Intersection semantics for skillIds — candidate must hold ALL of them.
    for (const sid of skillIntersection) {
      AND.push({ skills: { some: { skillId: sid } } });
    }
    // Require at least one overlap with required skills when the job has any.
    if (requiredIds.length > 0 && skillIntersection.length === 0) {
      AND.push({ skills: { some: { skillId: { in: requiredIds } } } });
    }
    if (AND.length > 0) where.AND = AND;

    const candidates = await client.candidate.findMany({
      where,
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
        skills: {
          where: requiredIds.length ? { skillId: { in: requiredIds } } : undefined,
          select: { skillId: true, skill: { select: { id: true, name: true } } },
        },
      },
      // Keep the shortlist bounded; we post-score in memory.
      take: Math.max(take * 4, 100),
      orderBy: { updatedAt: 'desc' },
    });

    // ----- Score each candidate -----------------------------------------
    const requiredMap = new Map(requiredSkills.map((s) => [s.id, s]));
    const now = Date.now();
    const ranked: RecommendedCandidate[] = candidates.map((c) => {
      const matchedSkills: SkillRef[] = c.skills.map((s) => ({
        id: s.skillId,
        name: s.skill?.name ?? '',
      }));
      const matchedSet = new Set(matchedSkills.map((s) => s.id));
      const missingSkills = requiredSkills.filter((s) => !matchedSet.has(s.id));
      const skillsPct =
        requiredSkills.length === 0 ? 0 : (matchedSet.size / requiredSkills.length) * 100;

      const locationPct = scoreLocationMatch(job.location, c.location);
      const titlePct = scoreTitleMatch(job.title, c.currentTitle);
      const freshnessPct = scoreFreshness(c.updatedAt, now);
      // YoE is optional — we excluded it when the candidate didn't list one.
      const yoePct =
        typeof c.yearsExperience === 'number' ? scoreYoeFit(c.yearsExperience) : null;

      const weights = RecommendationsService.WEIGHTS;
      let contrib =
        (skillsPct * weights.skills +
          locationPct * weights.location +
          titlePct * weights.title +
          freshnessPct * weights.freshness) /
        100;
      // Rebalance so a missing optional signal (YoE) doesn't cap the max at 95%.
      let denom =
        weights.skills + weights.location + weights.title + weights.freshness;
      if (yoePct !== null) {
        contrib += (yoePct * weights.yoe) / 100;
        denom += weights.yoe;
      }
      const scorePct = Math.round((contrib / denom) * 100);

      const reasons: string[] = [];
      if (requiredSkills.length > 0) {
        reasons.push(
          `${matchedSet.size}/${requiredSkills.length} required skills (${Math.round(skillsPct)}%)`,
        );
      }
      if (job.location && c.location) {
        reasons.push(
          locationPct >= 80
            ? 'Location matches'
            : locationPct >= 40
              ? 'Nearby location'
              : 'Different location',
        );
      }
      if (c.currentTitle) {
        reasons.push(
          titlePct >= 70 ? 'Title closely matches' : titlePct >= 30 ? 'Related title' : 'Title differs',
        );
      }

      return {
        candidate: {
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          headline: c.headline,
          location: c.location,
          currentCompany: c.currentCompany,
          currentTitle: c.currentTitle,
          yearsExperience: c.yearsExperience,
          updatedAt: c.updatedAt,
        },
        score: matchedSet.size,
        scorePct,
        breakdown: {
          skillsPct: Math.round(skillsPct),
          locationPct: Math.round(locationPct),
          titlePct: Math.round(titlePct),
          freshnessPct: Math.round(freshnessPct),
          yoePct: yoePct === null ? null : Math.round(yoePct),
          weights,
        },
        reasons,
        matchedSkills: matchedSkills
          .map((s) => requiredMap.get(s.id) ?? s)
          .filter((s): s is SkillRef => Boolean(s?.id && s?.name)),
        missingSkills,
      };
    });

    // Filter: if job has required skills, keep the old "must have at least
    // one overlap" invariant strict in the response too.
    const filtered =
      requiredSkills.length > 0 ? ranked.filter((r) => r.score > 0) : ranked;

    filtered.sort((a, b) => {
      if (b.scorePct !== a.scorePct) return b.scorePct - a.scorePct;
      if (b.score !== a.score) return b.score - a.score;
      return b.candidate.updatedAt.getTime() - a.candidate.updatedAt.getTime();
    });

    return {
      jobId: job.id,
      requiredSkills,
      candidates: filtered.slice(0, take),
    };
  }
}

/**
 * 0..100 similarity between the job location and the candidate location.
 * Both are free-form strings so we do a tokenised contains check: any
 * shared token (city or country) gives a partial score, an exact case-
 * insensitive match gives full marks.
 */
function scoreLocationMatch(jobLoc: string | null, candLoc: string | null): number {
  if (!jobLoc || !candLoc) return 0;
  const j = jobLoc.toLowerCase().trim();
  const c = candLoc.toLowerCase().trim();
  if (!j || !c) return 0;
  if (j === c) return 100;
  if (j.includes(c) || c.includes(j)) return 80;
  const jTokens = tokenize(j);
  const cTokens = tokenize(c);
  if (jTokens.length === 0 || cTokens.length === 0) return 0;
  const shared = jTokens.filter((t) => cTokens.includes(t)).length;
  if (shared === 0) return 0;
  return Math.min(60, Math.round((shared / Math.max(jTokens.length, cTokens.length)) * 100));
}

/** Token-level Jaccard similarity between the job title and candidate title. */
function scoreTitleMatch(jobTitle: string, candTitle: string | null): number {
  if (!candTitle) return 0;
  const a = tokenize(jobTitle);
  const b = tokenize(candTitle);
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set(a);
  const shared = b.filter((t) => set.has(t)).length;
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 0;
  return Math.round((shared / union) * 100);
}

/** Exponential decay freshness score, 100 at `now`, ~50 after half-life days. */
function scoreFreshness(updatedAt: Date, now: number): number {
  const days = Math.max(0, (now - updatedAt.getTime()) / 86_400_000);
  const halfLife = 60;
  const val = Math.exp(-Math.LN2 * (days / halfLife));
  return Math.round(val * 100);
}

/**
 * Without a structured seniority requirement on the Job itself, we reward
 * the "sweet spot" (3-10y) and lightly penalize extremes. This is a
 * placeholder — swap for a real window once Job has minYoe/maxYoe.
 */
function scoreYoeFit(yoe: number): number {
  if (yoe < 0) return 0;
  if (yoe <= 2) return 40 + yoe * 20; // 40, 60, 80
  if (yoe <= 10) return 100;
  if (yoe <= 20) return Math.max(0, 100 - (yoe - 10) * 4);
  return 40;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}
