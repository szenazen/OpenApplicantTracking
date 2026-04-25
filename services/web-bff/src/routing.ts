/**
 * Resolves which upstream the Web BFF should use for a request.
 * Mirrors the strangler rules previously implemented in
 * `services/api-gateway/nginx.conf` — one entry for the browser, Account
 * service vs monolith (see design/ATS-design.drawio.xml: Web BFF, services).
 */
export type UpstreamKind = 'monolith' | 'account' | 'self';

/**
 * @param method HTTP method
 * @param url Full URL path including query (e.g. /api/health?x=1)
 */
export function resolveUpstream(method: string, url: string): UpstreamKind {
  const m = method.toUpperCase();
  const p = (url.split('?')[0] ?? '').split('#')[0] ?? '';

  if (p === '/gateway-health' || p === '/bff-health') {
    return 'self';
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
