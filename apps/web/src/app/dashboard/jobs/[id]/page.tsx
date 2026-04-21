'use client';

import { useCallback, useState } from 'react';
import { KanbanBoard } from '@/components/KanbanBoard';
import { CandidateDrawer } from '@/components/CandidateDrawer';
import { useJob } from './JobContext';

/**
 * Default "Candidates" tab for a job — the Kanban board and candidate
 * drawer. Job data is loaded by the parent layout and shared via
 * {@link useJob}; this tab only owns the drawer selection state and
 * publishes Kanban card changes upward so the header summary tiles stay
 * live during drag-and-drop.
 */
export default function JobCandidatesPage() {
  const { job, pipeline, initialApplications, setLiveApplications } = useJob();
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

  const handleCardsChange = useCallback(
    (cards: Parameters<typeof setLiveApplications>[0]) => setLiveApplications(cards),
    [setLiveApplications],
  );
  const handleOpenCard = useCallback((applicationId: string) => {
    setSelectedAppId(applicationId);
  }, []);
  const handleCloseDrawer = useCallback(() => setSelectedAppId(null), []);

  return (
    <>
      <KanbanBoard
        jobId={job.id}
        pipeline={pipeline}
        initialCards={initialApplications}
        onCardsChange={handleCardsChange}
        onOpenCard={handleOpenCard}
      />
      <CandidateDrawer applicationId={selectedAppId} onClose={handleCloseDrawer} />
    </>
  );
}
