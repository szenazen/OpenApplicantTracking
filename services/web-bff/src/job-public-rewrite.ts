/**
 * When the BFF routes public `GET /api/jobs` to pipeline-service, rewrite to
 * `/api/slice/pipeline/accounts/{accountId}/jobs` (query string preserved).
 *
 * Only the **paginated index** is sliced; `GET /api/jobs/:id`, creates, and
 * updates stay on the backup API until the slice stores full job/kanban data.
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
