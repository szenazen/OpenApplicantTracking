'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CandidateDrawer } from '@/components/CandidateDrawer';
import { drawerHandledByPage } from '@/lib/dashboard-drawer-url';

/**
 * Renders {@link CandidateDrawer} from `?application=` / `?candidate=` on any
 * dashboard route that does not already mount its own drawer (candidates
 * list, job Kanban, job recommendations). Must render under a Next.js
 * `Suspense` boundary because it uses `useSearchParams`.
 */
export function DashboardCandidateDrawer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const skip = drawerHandledByPage(pathname);
  const appId = searchParams.get('application');
  const candidateId = searchParams.get('candidate');
  const shouldShow = !skip && (Boolean(appId) || Boolean(candidateId));

  const onClose = useCallback(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete('application');
    p.delete('candidate');
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  if (!shouldShow) return null;

  return (
    <CandidateDrawer
      applicationId={appId}
      previewCandidateId={appId ? null : candidateId}
      onClose={onClose}
    />
  );
}
