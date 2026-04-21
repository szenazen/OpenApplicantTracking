/**
 * Stub external sourcing provider.
 *
 * Simulates a LinkedIn/Indeed-style search API against a small in-memory
 * dataset. Kept deliberately simple so:
 *   - integration tests are hermetic (no network, no seed drift),
 *   - UI development doesn't require external keys/accounts,
 *   - swapping a real provider in later is a drop-in of the same interface.
 *
 * The interface below is the contract for all future providers:
 *   - `search({ query, limit })` — returns zero-or-more candidates ordered
 *     by relevance. `externalId` must be stable across calls so dedup at
 *     import time can key off it.
 *   - `fetch(externalId)` — retrieves a single candidate payload, which is
 *     then normalized by the sourcing service.
 */

export interface ExternalCandidate {
  externalId: string;
  firstName: string;
  lastName: string;
  email?: string;
  headline?: string;
  location?: string;
  currentCompany?: string;
  currentTitle?: string;
  yearsExperience?: number;
  summary?: string;
  profileUrl?: string;
  skills?: string[];
}

export interface ExternalSourcingProvider {
  /** Stable, human-readable source identifier (e.g. "linkedin-stub"). */
  readonly source: string;
  search(opts: { query: string; limit?: number }): Promise<ExternalCandidate[]>;
  fetch(externalId: string): Promise<ExternalCandidate | null>;
}

/** In-memory fixture that covers all the filterable fields our search exercises. */
const FIXTURES: ExternalCandidate[] = [
  {
    externalId: 'li-adelia-ng',
    firstName: 'Adelia',
    lastName: 'Ng',
    email: 'adelia.ng@example.com',
    headline: 'Senior Platform Engineer',
    location: 'Singapore',
    currentCompany: 'Grabtech',
    currentTitle: 'Senior Platform Engineer',
    yearsExperience: 9,
    summary: 'Distributed systems, Kubernetes, Go.',
    profileUrl: 'https://linkedin.example/in/adelia-ng',
    skills: ['Go', 'Kubernetes', 'PostgreSQL', 'Kafka'],
  },
  {
    externalId: 'li-marcus-klein',
    firstName: 'Marcus',
    lastName: 'Klein',
    email: 'marcus.klein@example.com',
    headline: 'Staff Frontend Engineer',
    location: 'Berlin',
    currentCompany: 'Zalando',
    currentTitle: 'Staff Frontend Engineer',
    yearsExperience: 11,
    summary: 'Design systems, TypeScript, React.',
    profileUrl: 'https://linkedin.example/in/marcus-klein',
    skills: ['TypeScript', 'React', 'Next.js', 'Testing Library'],
  },
  {
    externalId: 'li-priya-shah',
    firstName: 'Priya',
    lastName: 'Shah',
    email: 'priya.shah@example.com',
    headline: 'Senior Product Designer',
    location: 'Bangalore',
    currentCompany: 'Zomato',
    currentTitle: 'Senior Product Designer',
    yearsExperience: 7,
    summary: 'B2B SaaS, design systems, research.',
    profileUrl: 'https://linkedin.example/in/priya-shah',
    skills: ['Figma', 'User Research', 'Accessibility'],
  },
  {
    externalId: 'li-ethan-ward',
    firstName: 'Ethan',
    lastName: 'Ward',
    email: 'ethan.ward@example.com',
    headline: 'Backend Engineer, Payments',
    location: 'London',
    currentCompany: 'Monzo',
    currentTitle: 'Backend Engineer',
    yearsExperience: 5,
    summary: 'Payment rails, idempotency, event sourcing.',
    profileUrl: 'https://linkedin.example/in/ethan-ward',
    skills: ['Java', 'Kotlin', 'Kafka', 'PostgreSQL'],
  },
  {
    externalId: 'li-yuki-tanaka',
    firstName: 'Yuki',
    lastName: 'Tanaka',
    email: 'yuki.tanaka@example.com',
    headline: 'Data Scientist',
    location: 'Tokyo',
    currentCompany: 'Rakuten',
    currentTitle: 'Data Scientist',
    yearsExperience: 6,
    summary: 'Recsys, ranking, A/B testing at scale.',
    profileUrl: 'https://linkedin.example/in/yuki-tanaka',
    skills: ['Python', 'PyTorch', 'SQL', 'Airflow'],
  },
];

/** Simple token-match relevance — substring and skill hits both count. */
function score(c: ExternalCandidate, tokens: string[]): number {
  if (tokens.length === 0) return 1;
  const hay = [
    c.firstName,
    c.lastName,
    c.headline,
    c.currentCompany,
    c.currentTitle,
    c.location,
    c.summary,
    ...(c.skills ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  let s = 0;
  for (const t of tokens) if (hay.includes(t)) s += 1;
  return s;
}

export class LinkedInStubProvider implements ExternalSourcingProvider {
  readonly source = 'linkedin-stub';

  async search({ query, limit = 10 }: { query: string; limit?: number }) {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const ranked = FIXTURES
      .map((c) => ({ c, s: score(c, tokens) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, Math.max(1, Math.min(50, limit)));
    return ranked.map((r) => r.c);
  }

  async fetch(externalId: string) {
    return FIXTURES.find((c) => c.externalId === externalId) ?? null;
  }
}
