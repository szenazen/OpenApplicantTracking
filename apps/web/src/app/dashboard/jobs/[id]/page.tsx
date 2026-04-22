'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { KanbanBoard } from '@/components/KanbanBoard';
import { CandidateDrawer } from '@/components/CandidateDrawer';
import type { ApplicationCard } from '@/lib/api';
import { useJob } from './JobContext';

/**
 * Default "Candidates" tab for a job — the Kanban board and candidate
 * drawer. Job data is loaded by the parent layout and shared via
 * {@link useJob}; this tab owns:
 *   - the drawer selection state,
 *   - the `?application=<id>` URL sync (so the drawer is a deep-linkable
 *     surface — e.g. an activity feed entry can jump straight into it),
 *   - the Kanban card overrides so drawer-side comment / reaction /
 *     candidate edits update the board badges without a full refetch.
 */
export default function JobCandidatesPage() {
  const { job, pipeline, initialApplications, setLiveApplications } = useJob();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlAppId = searchParams.get('application');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(urlAppId);
  const [cardOverrides, setCardOverrides] = useState<Record<string, Partial<ApplicationCard>>>({});

  // Sync in from the URL: if the caller lands on this page with
  // `?application=<id>`, open the drawer automatically. This backs the
  // deep-links emitted by the Activity feed and the global command palette.
  useEffect(() => {
    if (urlAppId && urlAppId !== selectedAppId) {
      setSelectedAppId(urlAppId);
    }
    if (!urlAppId && selectedAppId) {
      // URL dropped the param (e.g. browser back button) — mirror that in state.
      setSelectedAppId(null);
    }
    // Intentionally only watches urlAppId so internal state changes aren't
    // fighting with the URL for ownership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAppId]);

  const setUrlAppId = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (next) {
        if (params.get('application') === next) return;
        params.set('application', next);
      } else {
        if (!params.has('application')) return;
        params.delete('application');
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const handleCardsChange = useCallback(
    (cards: Parameters<typeof setLiveApplications>[0]) => setLiveApplications(cards),
    [setLiveApplications],
  );
  const handleOpenCard = useCallback(
    (applicationId: string) => {
      setSelectedAppId(applicationId);
      setUrlAppId(applicationId);
    },
    [setUrlAppId],
  );
  const handleCloseDrawer = useCallback(() => {
    setSelectedAppId(null);
    setUrlAppId(null);
  }, [setUrlAppId]);
  const handleActivityChange = useCallback(
    (
      applicationId: string,
      patch: {
        commentCount?: number;
        reactionSummary?: ApplicationCard['reactionSummary'];
        card?: Partial<ApplicationCard>;
      },
    ) => {
      setCardOverrides((prev) => {
        const prior = prev[applicationId] ?? {};
        const next: Partial<ApplicationCard> = { ...prior };
        if (patch.commentCount !== undefined) next.commentCount = patch.commentCount;
        if (patch.reactionSummary !== undefined) next.reactionSummary = patch.reactionSummary;
        if (patch.card) {
          // Merge shallow card fields. The drawer passes a fully-formed
          // `candidate` object when it changes, so a direct override is
          // safe — no field-by-field dance needed.
          Object.assign(next, patch.card);
        }
        return { ...prev, [applicationId]: next };
      });
    },
    [],
  );

  return (
    <>
      <KanbanBoard
        jobId={job.id}
        pipeline={pipeline}
        initialCards={initialApplications}
        onCardsChange={handleCardsChange}
        onOpenCard={handleOpenCard}
        cardOverrides={cardOverrides}
      />
      <CandidateDrawer
        applicationId={selectedAppId}
        onClose={handleCloseDrawer}
        pipeline={pipeline}
        onActivityChange={handleActivityChange}
      />
    </>
  );
}
