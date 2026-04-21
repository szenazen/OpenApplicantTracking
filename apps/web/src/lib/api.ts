/**
 * Tiny fetch wrapper that:
 *   - points at the NestJS API (rewritten to /api/* by next.config.js)
 *   - attaches the JWT from localStorage
 *   - optionally attaches the active account id as `x-account-id`
 *   - throws a typed ApiError on non-2xx so components can show real messages
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
  }
}

const API_PREFIX = '/api';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('oat.token');
}

function getActiveAccountId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('oat.activeAccountId');
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Pass `false` to skip x-account-id header even when one is active. */
  withAccount?: boolean;
  /** Override the account id (e.g. when switching). */
  accountId?: string;
  /** Additional request headers (e.g. Idempotency-Key for safe retries). */
  headers?: Record<string, string>;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const accountId = opts.accountId ?? (opts.withAccount === false ? null : getActiveAccountId());
  if (accountId) headers['x-account-id'] = accountId;
  if (opts.headers) Object.assign(headers, opts.headers);

  const res = await fetch(`${API_PREFIX}${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  const body = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const msg = (body as any)?.message ?? res.statusText ?? 'Request failed';
    throw new ApiError(res.status, body, Array.isArray(msg) ? msg.join(', ') : msg);
  }
  return body as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ----- Domain types mirroring the API response shapes -----

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  accounts: Array<{ id: string; name: string; slug: string; region: string; role: string }>;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface JobSummary {
  id: string;
  title: string;
  description?: string | null;
  department?: string | null;
  location?: string | null;
  employmentType?: string | null;
  status: string;
  pipelineId: string;
  requiredSkillIds?: string[];
  openedAt?: string | null;
}

/** Matches the backend `StatusCategory` enum (see regional.prisma). */
export type StatusCategory = 'NEW' | 'IN_PROGRESS' | 'HIRED' | 'DROPPED' | string;

export interface PipelineStatus {
  id: string;
  name: string;
  position: number;
  category: StatusCategory;
  color?: string | null;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  statuses: PipelineStatus[];
}

export type ReactionKind = 'THUMBS_UP' | 'THUMBS_DOWN' | 'STAR';

/**
 * Aggregate of reactions on an application, plus the current viewer's own
 * reactions so the UI can toggle with a single render.
 */
export interface ReactionSummary {
  counts: Record<ReactionKind, number>;
  myReactions: ReactionKind[];
}

export interface ApplicationCard {
  id: string;
  candidateId: string;
  jobId: string;
  currentStatusId: string;
  position: number;
  /** Optimistic-concurrency token — the board echoes it back on PATCH /move. */
  version?: number;
  appliedAt?: string | null;
  lastTransitionAt?: string | null;
  /** Number of non-deleted HR/hiring-manager comments on this application. */
  commentCount?: number;
  /** Aggregate reactions + the viewer's own state, for card badges. */
  reactionSummary?: ReactionSummary;
  candidate: {
    id: string;
    firstName: string;
    lastName: string;
    headline?: string | null;
    currentTitle?: string | null;
    currentCompany?: string | null;
    yearsExperience?: number | null;
    location?: string | null;
  };
}

/**
 * A single pipeline transition, matching the APPLICATION_STATUS_HISTORY table
 * in `design/ATS-design.drawio.xml` (plus the server-resolved name/display fields).
 */
export interface ApplicationTransitionDetail {
  id: string;
  createdAt: string;
  reason?: string | null;
  fromStatusId: string | null;
  toStatusId: string;
  fromStatusName: string | null;
  toStatusName: string | null;
  byUserId: string;
  byUserDisplayName: string | null;
  byUserAvatarUrl: string | null;
}

/**
 * Row shape returned by GET /candidates — drives the dedicated Candidates
 * list view. `applicationCounts.active` excludes pipeline statuses in
 * categories HIRED and DROPPED so it matches the recruiter's mental model
 * of "open work".
 */
export interface CandidateListItem {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  headline?: string | null;
  location?: string | null;
  currentCompany?: string | null;
  currentTitle?: string | null;
  yearsExperience?: number | null;
  source?: string | null;
  createdAt: string;
  applicationCounts: { total: number; active: number };
  skills: Array<{ skillId: string; name: string; level: number | null }>;
}

/** Full application payload returned by GET /applications/:id — drives the candidate drawer. */
export interface ApplicationDetail {
  id: string;
  candidateId: string;
  jobId: string;
  currentStatusId: string;
  position: number;
  version: number;
  appliedAt: string;
  lastTransitionAt: string;
  notes?: string | null;
  candidate: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    headline?: string | null;
    location?: string | null;
    currentCompany?: string | null;
    currentTitle?: string | null;
    yearsExperience?: number | null;
    summary?: string | null;
    source?: string | null;
    /** Flattened CANDIDATE_SKILLS rows — name + optional 1..5 level. */
    skills?: Array<{
      skillId: string;
      name: string;
      category?: string | null;
      slug?: string | null;
      level?: number | null;
    }>;
  };
  job: {
    id: string;
    title: string;
    department?: string | null;
    location?: string | null;
    pipelineId: string;
  };
  currentStatus: PipelineStatus;
  transitions: ApplicationTransitionDetail[];
  /** Hydrated by the API for the candidate drawer — see ApplicationsService.get. */
  commentCount?: number;
  reactionSummary?: ReactionSummary;
}

/**
 * Application-scoped comment written by an HR/hiring manager.
 * Follows the same OCC + idempotency contract as {@link JobNote}.
 */
export interface ApplicationComment {
  id: string;
  applicationId: string;
  authorUserId: string;
  body: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    displayName: string | null;
    email: string;
    avatarUrl: string | null;
  } | null;
}

/**
 * Job-scoped collaboration note — see `JobNote` in regional.prisma.
 *
 * `version` is the optimistic-concurrency token: PATCH / DELETE must echo it
 * back in `expectedVersion` to avoid silent overwrites. The server also
 * accepts an `Idempotency-Key` header on POST to dedupe retries.
 */
export interface JobNote {
  id: string;
  jobId: string;
  authorUserId: string;
  body: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    displayName: string | null;
    email: string;
    avatarUrl: string | null;
  } | null;
}
