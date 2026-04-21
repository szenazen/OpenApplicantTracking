'use client';

import { useCallback, useState } from 'react';
import { KanbanBoard } from '@/components/KanbanBoard';
import { CandidateDrawer } from '@/components/CandidateDrawer';
import type { ApplicationCard } from '@/lib/api';
import { useJob } from './JobContext';

/**
 * Default "Candidates" tab for a job — the Kanban board and candidate
 * drawer. Job data is loaded by the parent layout and shared via
 * {@link useJob}; this tab only owns the drawer selection state and
 * publishes Kanban card changes upward so the header summary tiles stay
 * live during drag-and-drop.
 *
 * The drawer also emits comment / reaction activity events so Kanban card
 * badges stay in sync without a full job refetch (see `cardOverrides`).
 */
export default function JobCandidatesPage() {
  const { job, pipeline, initialApplications, setLiveApplications } = useJob();
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [cardOverrides, setCardOverrides] = useState<Record<string, Partial<ApplicationCard>>>({});

  const handleCardsChange = useCallback(
    (cards: Parameters<typeof setLiveApplications>[0]) => setLiveApplications(cards),
    [setLiveApplications],
  );
  const handleOpenCard = useCallback((applicationId: string) => {
    setSelectedAppId(applicationId);
  }, []);
  const handleCloseDrawer = useCallback(() => setSelectedAppId(null), []);
  const handleActivityChange = useCallback(
    (applicationId: string, patch: Partial<ApplicationCard>) => {
      setCardOverrides((prev) => ({
        ...prev,
        [applicationId]: { ...(prev[applicationId] ?? {}), ...patch },
      }));
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
        onActivityChange={handleActivityChange}
      />
    </>
  );
}
