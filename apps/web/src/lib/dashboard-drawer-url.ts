/**
 * Shared helpers for deep-linking the candidate drawer via query params on
 * `/dashboard/*` routes: `application` (existing application) vs `candidate`
 * (profile preview via GET /candidates/:id).
 */

export function mergeDrawerIntoSearchParams(
  current: URLSearchParams,
  next: { application: string | null } | { candidate: string | null },
): URLSearchParams {
  const p = new URLSearchParams(current.toString());
  if ('application' in next) {
    if (next.application) p.set('application', next.application);
    else p.delete('application');
    p.delete('candidate');
  } else {
    if (next.candidate) p.set('candidate', next.candidate);
    else p.delete('candidate');
    p.delete('application');
  }
  return p;
}

export function drawerHandledByPage(pathname: string): boolean {
  if (pathname === '/dashboard/candidates') return true;
  if (/^\/dashboard\/jobs\/[^/]+$/.test(pathname)) return true;
  if (/^\/dashboard\/jobs\/[^/]+\/recommendations$/.test(pathname)) return true;
  return false;
}
