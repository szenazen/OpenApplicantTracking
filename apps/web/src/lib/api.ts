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
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const accountId = opts.accountId ?? (opts.withAccount === false ? null : getActiveAccountId());
  if (accountId) headers['x-account-id'] = accountId;

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
  department?: string | null;
  location?: string | null;
  status: string;
  pipelineId: string;
  openedAt?: string | null;
}

export interface PipelineStatus {
  id: string;
  name: string;
  position: number;
  category: string;
  color?: string | null;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  statuses: PipelineStatus[];
}

export interface ApplicationCard {
  id: string;
  candidateId: string;
  jobId: string;
  currentStatusId: string;
  position: number;
  candidate: {
    id: string;
    firstName: string;
    lastName: string;
    headline?: string | null;
  };
}
