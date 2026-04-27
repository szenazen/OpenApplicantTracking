import { bffJobsToSliceEnabled, isPublicJobsListPath } from './job-public-rewrite';
import { bffPipelinesToSliceEnabled, isPublicPipelinesPath } from './pipeline-public-rewrite';

/**
 * Resolves which upstream the Web BFF should use for a request.
 * **Primary:** extracted services (account, pipeline, auth, …). **Backup:**
 * `apps/api` at `MONOLITH_URL` — Nest modular monolith for routes not yet owned
 * by a slice (see design/ATS-design.drawio.xml and design/strangler-vs-ats-diagram.md).
 *
 * The identifier `monolith` in {@link UpstreamKind} means that backup API, not
 * “center of architecture.”
 */
export type UpstreamKind = 'monolith' | 'account' | 'pipeline' | 'auth' | 'self';

function isEnabled(name: 'PIPELINE_SLICE' | 'AUTH_SLICE'): boolean {
  const k = name === 'PIPELINE_SLICE' ? 'PIPELINE_SLICE_ENABLED' : 'AUTH_SLICE_ENABLED';
  return process.env[k] === '1' || process.env[k] === 'true';
}

/**
 * @param method HTTP method
 * @param url Full URL path including query (e.g. /api/health?x=1)
 */
export function resolveUpstream(method: string, url: string): UpstreamKind {
  const m = method.toUpperCase();
  const p = (url.split('?')[0] ?? '').split('#')[0] ?? '';

  if (p === '/gateway-health' || p === '/bff-health' || p === '/api/bff/aggregated-health') {
    return 'self';
  }

  if (isEnabled('PIPELINE_SLICE') && p.startsWith('/api/slice/pipeline')) {
    return 'pipeline';
  }

  /** Strangler: same JSON as monolith `/api/pipelines` → pipeline-service (needs `x-account-id`). */
  if (bffPipelinesToSliceEnabled() && isPublicPipelinesPath(p)) {
    return 'pipeline';
  }

  /** Strangler: paginated `GET /api/jobs` only → pipeline-service (detail + mutations stay on monolith). */
  if (bffJobsToSliceEnabled() && m === 'GET' && isPublicJobsListPath(p)) {
    return 'pipeline';
  }

  if (isEnabled('AUTH_SLICE') && p.startsWith('/api/slice/auth')) {
    return 'auth';
  }

  if (p === '/api/accounts') {
    return 'monolith';
  }

  if (/^\/api\/accounts\/current(\/|$)/.test(p)) {
    return 'account';
  }

  if (/^\/api\/accounts\/[^/]+$/.test(p)) {
    return 'account';
  }

  if (p === '/api/invitations' || p.startsWith('/api/invitations/')) {
    return 'account';
  }

  if (p.startsWith('/api/platform/accounts')) {
    if (m === 'POST') {
      return 'monolith';
    }
    return 'account';
  }

  if (p.startsWith('/realtime')) {
    return 'monolith';
  }

  return 'monolith';
}
