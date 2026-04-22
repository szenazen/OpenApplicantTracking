import { Injectable } from '@nestjs/common';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

export interface SearchJobHit {
  type: 'job';
  id: string;
  title: string;
  status: string;
  department: string | null;
  location: string | null;
}

export interface SearchCandidateHit {
  type: 'candidate';
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
}

export type SearchHit = SearchJobHit | SearchCandidateHit;

export interface SearchResult {
  query: string;
  jobs: SearchJobHit[];
  candidates: SearchCandidateHit[];
  total: number;
}

/**
 * Unified search for the Cmd+K command palette.
 *
 * We deliberately keep this small (5 + 5 hits) so the dropdown is
 * scannable — anything beyond that should navigate to the dedicated
 * listing page (/dashboard/jobs, /dashboard/candidates). The palette is
 * for *pivoting*, not for browsing.
 *
 * Multi-tenant safety: every query is scoped by `accountId`; the caller's
 * AccountGuard has already asserted the user belongs to that account.
 */
@Injectable()
export class SearchService {
  constructor(private readonly router: RegionRouterService) {}

  async search(accountId: string, raw: string): Promise<SearchResult> {
    const q = (raw ?? '').trim();
    if (q.length < 2) {
      return { query: q, jobs: [], candidates: [], total: 0 };
    }
    const { client } = await this.router.forAccount(accountId);

    // A single round-trip — both queries fire against the same regional
    // pool. Take(5) each so the palette can render at most 10 rows.
    const [jobs, candidates] = await Promise.all([
      client.job.findMany({
        where: {
          accountId,
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { department: { contains: q, mode: 'insensitive' } },
            { location: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: { id: true, title: true, status: true, department: true, location: true },
        orderBy: [{ updatedAt: 'desc' }],
        take: 5,
      }),
      client.candidate.findMany({
        where: {
          accountId,
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { currentTitle: { contains: q, mode: 'insensitive' } },
            { currentCompany: { contains: q, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          currentTitle: true,
          currentCompany: true,
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: 5,
      }),
    ]);

    const jobHits: SearchJobHit[] = jobs.map((j) => ({
      type: 'job',
      id: j.id,
      title: j.title,
      status: String(j.status),
      department: j.department,
      location: j.location,
    }));
    const candidateHits: SearchCandidateHit[] = candidates.map((c) => ({
      type: 'candidate',
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
      currentTitle: c.currentTitle,
      currentCompany: c.currentCompany,
    }));

    return {
      query: q,
      jobs: jobHits,
      candidates: candidateHits,
      total: jobHits.length + candidateHits.length,
    };
  }
}
