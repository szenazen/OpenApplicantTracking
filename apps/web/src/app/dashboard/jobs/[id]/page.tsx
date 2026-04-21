'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { api, ApplicationCard, JobSummary, Pipeline } from '@/lib/api';
import { KanbanBoard } from '@/components/KanbanBoard';

export default function JobBoardPage({ params }: { params: { id: string } }) {
  const [job, setJob] = useState<JobSummary | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [cards, setCards] = useState<ApplicationCard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<JobSummary>(`/jobs/${params.id}`),
      api<{ applications: ApplicationCard[] }>(`/jobs/${params.id}/applications`),
    ])
      .then(async ([j, apps]) => {
        if (cancelled) return;
        setJob(j);
        const p = await api<Pipeline>(`/pipelines/${j.pipelineId}`);
        if (cancelled) return;
        setPipeline(p);
        setCards(apps.applications ?? (apps as any));
      })
      .catch((e) => setErr(e.message ?? 'Failed to load job'));
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (err) return <p className="p-6 text-sm text-red-700">{err}</p>;
  if (!job || !pipeline || !cards) return <p className="p-6 text-sm text-slate-500">Loading…</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-6 py-3">
        <Link
          href="/dashboard"
          className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={12} /> back to jobs
        </Link>
        <h1 className="text-lg font-semibold tracking-tight" data-testid="job-title">
          {job.title}
        </h1>
      </div>
      <KanbanBoard jobId={job.id} pipeline={pipeline} initialCards={cards} />
    </div>
  );
}
