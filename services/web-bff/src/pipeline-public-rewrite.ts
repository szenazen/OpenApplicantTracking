/**
 * When the BFF routes public `/api/pipelines` to pipeline-service, rewrite to the
 * slice path: `/api/slice/pipeline/accounts/{accountId}/pipelines/...`
 * (see apps/api PipelinesSliceClientService).
 */
export function bffPipelinesToSliceEnabled(): boolean {
  return process.env.BFF_PIPELINES_TO_SLICE === '1' || process.env.BFF_PIPELINES_TO_SLICE === 'true';
}

/** True for `/api/pipelines` and subpaths, but not e.g. `/api/pipelinesLegacy`. */
export function isPublicPipelinesPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/pipelines')) return false;
  return /^\/api\/pipelines(\/|$)/.test(pathname);
}

/**
 * @param requestUrl e.g. `/api/pipelines` or `/api/pipelines/x/statuses/reorder?a=1`
 */
export function rewritePipelinesToSlicePath(requestUrl: string, accountId: string): string {
  const [pathPart, ...queryParts] = requestUrl.split('?');
  const q = queryParts.length ? `?${queryParts.join('?')}` : '';
  if (!isPublicPipelinesPath(pathPart)) {
    throw new Error(`Not a /api/pipelines path: ${pathPart}`);
  }
  const rest = pathPart.slice('/api/pipelines'.length);
  const base = `/api/slice/pipeline/accounts/${encodeURIComponent(accountId)}`;
  const newPath =
    rest === '' || rest === '/'
      ? `${base}/pipelines`
      : `${base}/pipelines${rest.startsWith('/') ? rest : `/${rest}`}`;
  return newPath + q;
}
