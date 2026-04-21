'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApplicationCard, JobSummary, Pipeline } from '@/lib/api';
import { KanbanBoard } from '@/components/KanbanBoard';
import { JobHeader } from '@/components/JobHeader';
import { CandidateDrawer } from '@/components/CandidateDrawer';

type JobWithApplications = JobSummary & {
  pipeline: Pipeline;
  applications: ApplicationCard[];
};

export default function JobBoardPage({ params }: { params: { id: string } }) {
  const [job, setJob] = useState<JobSummary | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [initialCards, setInitialCards] = useState<ApplicationCard[] | null>(null);
  // Shadow copy of the Kanban's card list, so the JobHeader summary tiles stay
  // live as cards are dragged / socket events arrive. The Kanban owns the
  // canonical state (avoids re-render churn breaking drag), and reports changes
  // via an observer callback below.
  const [liveCards, setLiveCards] = useState<ApplicationCard[]>([]);
  // Id of the application whose drawer is currently open (null = closed).
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<JobWithApplications>(`/jobs/${params.id}`)
      .then((j) => {
        if (cancelled) return;
        setJob(j);
        setPipeline(j.pipeline);
        const apps = j.applications ?? [];
        setInitialCards(apps);
        setLiveCards(apps);
      })
      .catch((e) => setErr(e.message ?? 'Failed to load job'));
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const handleCardsChange = useCallback((cards: ApplicationCard[]) => {
    setLiveCards(cards);
  }, []);

  const handleOpenCard = useCallback((applicationId: string) => {
    setSelectedAppId(applicationId);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedAppId(null);
  }, []);

  if (err) return <p className="p-6 text-sm text-red-700">{err}</p>;
  if (!job || !pipeline || !initialCards) return <p className="p-6 text-sm text-slate-500">Loading…</p>;

  return (
    <div className="flex h-full flex-col">
      <JobHeader job={job} pipeline={pipeline} applications={liveCards} />
      <KanbanBoard
        jobId={job.id}
        pipeline={pipeline}
        initialCards={initialCards}
        onCardsChange={handleCardsChange}
        onOpenCard={handleOpenCard}
      />
      <CandidateDrawer applicationId={selectedAppId} onClose={handleCloseDrawer} />
    </div>
  );
}
