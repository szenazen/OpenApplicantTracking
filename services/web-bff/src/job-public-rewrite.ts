/**
 * When the BFF routes public `GET /api/jobs` to pipeline-service, rewrite to
 * `/api/slice/pipeline/accounts/{accountId}/jobs` or `.../jobs/{jobId}` (query preserved).
 *
 * `POST` / `PATCH` jobs stay on the backup API until writes are owned by the slice.
 */
export function bffJobsToSliceEnabled(): boolean {
  return process.env.BFF_JOBS_TO_SLICE === '1' || process.env.BFF_JOBS_TO_SLICE === 'true';
}

function trimJobsListPath(pathname: string): string {
  if (pathname === '/api/jobs/') return '/api/jobs';
  return pathname;
}

/** True only for the jobs index path, not `/api/jobs/:id`. */
export function isPublicJobsListPath(pathname: string): boolean {
  return trimJobsListPath(pathname) === '/api/jobs';
}

/** True for `GET /api/jobs/:jobId` (single segment after `/api/jobs`). */
export function isPublicJobsDetailPath(pathname: string): boolean {
  return /^\/api\/jobs\/[^/]+$/.test(pathname);
}

export function isPublicJobsReadPath(pathname: string): boolean {
  return isPublicJobsListPath(pathname) || isPublicJobsDetailPath(pathname);
}

/**
 * @param requestUrl e.g. `/api/jobs` or `/api/jobs?q=eng&limit=10`
 */
export function rewriteJobsListToSlicePath(requestUrl: string, accountId: string): string {
  const parts = requestUrl.split('?');
  const pathPart = parts[0] ?? '';
  const queryParts = parts.slice(1);
  const q = queryParts.length ? `?${queryParts.join('?')}` : '';
  if (!isPublicJobsListPath(pathPart)) {
    throw new Error(`Not a /api/jobs list path: ${pathPart}`);
  }
  const base = `/api/slice/pipeline/accounts/${encodeURIComponent(accountId)}/jobs`;
  return base + q;
}

/**
 * @param requestUrl e.g. `/api/jobs/clxxx` or `/api/jobs/clxxx?foo=1`
 */
export function rewriteJobsDetailToSlicePath(requestUrl: string, accountId: string): string {
  const parts = requestUrl.split('?');
  const pathPart = parts[0] ?? '';
  const queryParts = parts.slice(1);
  const q = queryParts.length ? `?${queryParts.join('?')}` : '';
  if (!isPublicJobsDetailPath(pathPart)) {
    throw new Error(`Not a /api/jobs/:id path: ${pathPart}`);
  }
  const jobId = pathPart.slice('/api/jobs/'.length);
  const base = `/api/slice/pipeline/accounts/${encodeURIComponent(accountId)}/jobs/${encodeURIComponent(jobId)}`;
  return base + q;
}
