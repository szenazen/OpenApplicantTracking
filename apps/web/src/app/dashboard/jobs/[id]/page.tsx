'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { KanbanBoard } from '@/components/KanbanBoard';
import { CandidateDrawer } from '@/components/CandidateDrawer';
import { api, type ApplicationCard } from '@/lib/api';
import { useJob } from './JobContext';

/**
 * Default "Candidates" tab for a job — the Kanban board and candidate
 * drawer. Job data is loaded by the parent layout and shared via
 * {@link useJob}; this tab owns:
 *   - `?application=<id>` and `?candidate=<id>` (preview / Cmd+K) as drawer
 *     selection, deep-linkable from Activities / command palette,
 *   - `?highlightCard=<applicationId>` (e.g. from Candidates / Cmd+K / Recommendations)
 *     scrolls to the Kanban card and runs a short blink, then drops the param,
 *   - the Kanban card overrides so drawer-side comment / reaction /
 *     candidate edits update the board badges without a full refetch.
 */
export default function JobCandidatesPage() {
  const { job, pipeline, initialApplications, setLiveApplications, refreshJob } = useJob();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlAppId = searchParams.get('application');
  const urlCandidateId = searchParams.get('candidate');
  const urlHighlightCard = searchParams.get('highlightCard');
  /** Local selection updates immediately; URL follows via `setUrlAppId` (Next can lag on `useSearchParams`). */
  const [selectedAppId, setSelectedAppId] = useState<string | null>(urlAppId);
  const [cardOverrides, setCardOverrides] = useState<Record<string, Partial<ApplicationCard>>>({});

  useEffect(() => {
    setSelectedAppId(urlAppId);
  }, [urlAppId]);

  const setUrlAppId = useCallback(
    (next: string | null) => {
      // Always read the live query string — `useSearchParams()` can lag `window.location`
      // after `router.replace`, so a stale snapshot makes close() think `application`
      // is already absent and skip navigation (drawer stuck open).
      const params = new URLSearchParams(window.location.search);
      if (next) {
        if (params.get('application') === next) return;
        params.set('application', next);
        params.delete('candidate');
      } else {
        if (!params.has('application') && !params.has('candidate')) return;
        params.delete('application');
        params.delete('candidate');
      }
      const qs = params.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      router.replace(href, { scroll: false });
      // Next's soft navigation doesn't always update `window.location` immediately;
      // keep the address bar in sync so Playwright, deep-links, and `useSearchParams` agree.
      window.history.replaceState(window.history.state ?? {}, '', href);
    },
    [pathname, router],
  );

  const clearHighlightFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('highlightCard')) return;
    params.delete('highlightCard');
    const qs = params.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    router.replace(href, { scroll: false });
    window.history.replaceState(window.history.state ?? {}, '', href);
  }, [pathname, router]);

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

  const addPreviewCandidateToJob = useCallback(async () => {
    if (!urlCandidateId) return;
    await api(`/applications`, {
      method: 'POST',
      body: { candidateId: urlCandidateId, jobId: job.id },
    });
    await refreshJob();
    handleCloseDrawer();
  }, [urlCandidateId, job.id, refreshJob, handleCloseDrawer]);
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
        highlightApplicationId={urlHighlightCard}
        onHighlightConsumed={clearHighlightFromUrl}
      />
      <CandidateDrawer
        applicationId={urlCandidateId ? null : selectedAppId}
        previewCandidateId={urlCandidateId}
        previewJobTitle={job.title}
        previewPrimaryAction={
          urlCandidateId
            ? { label: 'Add to job', onClick: () => void addPreviewCandidateToJob() }
            : null
        }
        onClose={handleCloseDrawer}
        pipeline={pipeline}
        onActivityChange={handleActivityChange}
      />
    </>
  );
}
