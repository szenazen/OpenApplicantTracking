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
   * Paginated + filtered candidate list for the Candidates page. We enrich
   * each row with:
   *   - `applicationCounts.{total, active}` — active = the candidate has at
   *     least one application whose pipeline status is not HIRED/DROPPED.
   *   - `skills` — flattened (skillId, name, level) tuples for chip rendering.
   *   - `mostRecentApplicationId` — for drawer deep-linking from the list.
   *
   * Pagination is **keyset** on `(createdAt DESC, id DESC)` so the list
   * stays stable when new candidates are being created concurrently
   * (offset-based pagination would skip or duplicate rows in that case).
   * `nextCursor` is returned whenever there is likely a next page; clients
   * pass it back on the next request.
   *
   * Filters are intentionally conservative — each one is expected to
   * narrow the set, and they AND together:
   *   - q          : case-insensitive substring across name/email/title/
   *                  company/headline/location (recruiters rarely know
   *                  which field a match will come from).
   *   - skillIds   : candidate must have ALL of these skills (AND) so
   *                  the filter is predictable; ANY-of semantics would
   *                  quickly expand the set and is less useful on a small
   *                  account.
   *   - hasActive  : true -> at least one non-terminal application; false
   *                  -> zero applications at all (no "only terminals"
   *                  bucket — recruiters don't ask for that).
   *   - minYoe/maxYoe: inclusive bounds. Null yoe is EXCLUDED when either
   *                  bound is set — "no data" is not "0 years".
   */
  async list(
    accountId: string,
    query?: {
      q?: string;
      skillIds?: string[];
      hasActive?: boolean;
      minYoe?: number;
      maxYoe?: number;
      limit?: number;
      cursor?: string;
    },
  ) {
    const { client } = await this.router.forAccount(accountId);
    const limit = Math.min(Math.max(query?.limit ?? 50, 1), 100);
    const q = query?.q?.trim() ?? '';
    const skillIds = (query?.skillIds ?? []).filter(Boolean);
    const hasActive = query?.hasActive;

    // Decode the keyset cursor — we encode `<createdAt_ms>_<id>` as
    // base64url so it's opaque from the client's perspective.
    let cursorCreatedAt: Date | undefined;
    let cursorId: string | undefined;
    if (query?.cursor) {
      try {
        const raw = Buffer.from(query.cursor, 'base64url').toString('utf8');
        const [ts, id] = raw.split('_');
        if (ts && id) {
          const ms = Number(ts);
          if (Number.isFinite(ms)) {
            cursorCreatedAt = new Date(ms);
            cursorId = id;
          }
        }
      } catch {
        // Ignore — bad cursor is treated as "start from the beginning".
      }
    }

    const yoeFilter: Record<string, number> = {};
    if (typeof query?.minYoe === 'number') yoeFilter.gte = query.minYoe;
    if (typeof query?.maxYoe === 'number') yoeFilter.lte = query.maxYoe;

    const where: Record<string, unknown> = {
      accountId,
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { currentTitle: { contains: q, mode: 'insensitive' } },
              { currentCompany: { contains: q, mode: 'insensitive' } },
              { headline: { contains: q, mode: 'insensitive' } },
              { location: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      // AND semantics on skills: one AND clause per required skill.
      ...(skillIds.length
        ? { AND: skillIds.map((sid) => ({ skills: { some: { skillId: sid } } })) }
        : {}),
      ...(Object.keys(yoeFilter).length ? { yearsExperience: yoeFilter } : {}),
      ...(hasActive === true
        ? {
            applications: {
              some: {
                currentStatus: { category: { notIn: ['HIRED', 'DROPPED'] } },
              },
            },
          }
        : hasActive === false
          ? { applications: { none: {} } }
          : {}),
      // Keyset: strictly after the cursor in (createdAt DESC, id DESC).
      ...(cursorCreatedAt && cursorId
        ? {
            OR: [
              { createdAt: { lt: cursorCreatedAt } },
              { createdAt: cursorCreatedAt, id: { lt: cursorId } },
            ],
          }
        : {}),
    };

    // If both `q` and cursor are set we'd clobber the OR array; merge with
    // AND instead. Prisma allows an explicit top-level AND array so the
    // two ORs don't overwrite each other.
    if (q && cursorCreatedAt && cursorId) {
      const andClauses = Array.isArray(where.AND) ? (where.AND as unknown[]) : [];
      andClauses.push({
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { currentTitle: { contains: q, mode: 'insensitive' } },
          { currentCompany: { contains: q, mode: 'insensitive' } },
          { headline: { contains: q, mode: 'insensitive' } },
          { location: { contains: q, mode: 'insensitive' } },
        ],
      });
      andClauses.push({
        OR: [
          { createdAt: { lt: cursorCreatedAt } },
          { createdAt: cursorCreatedAt, id: { lt: cursorId } },
        ],
      });
      delete (where as Record<string, unknown>).OR;
      where.AND = andClauses;
    }

    // Fetch limit+1 to detect whether more rows exist without a
    // separate COUNT query.
    const rows = await client.candidate.findMany({
      where,
      include: {
        applications: {
          select: {
            id: true,
            createdAt: true,
            currentStatus: { select: { category: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        skills: {
          select: { skillId: true, level: true, skill: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items = page.map(({ applications, skills, ...scalar }) => {
      const total = applications.length;
      const active = applications.filter(
        (a) => a.currentStatus.category !== 'HIRED' && a.currentStatus.category !== 'DROPPED',
      ).length;
      // Prefer a non-terminal "live" application for the drawer deep
      // link — that's the one the recruiter is most likely to want to
      // open. Fall back to the most-recent terminal application if none.
      const live = applications.find(
        (a) => a.currentStatus.category !== 'HIRED' && a.currentStatus.category !== 'DROPPED',
      );
      const mostRecent = live ?? applications[0];
      return {
        ...scalar,
        applicationCounts: { total, active },
        mostRecentApplicationId: mostRecent?.id ?? null,
        skills: skills.map((s) => ({ skillId: s.skillId, level: s.level, name: s.skill.name })),
      };
    });

    const last = page.at(-1);
    const nextCursor =
      hasMore && last
        ? Buffer.from(`${last.createdAt.getTime()}_${last.id}`, 'utf8').toString('base64url')
        : null;

    return { items, nextCursor };
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
