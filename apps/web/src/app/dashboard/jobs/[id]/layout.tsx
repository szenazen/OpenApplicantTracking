'use client';

import { useEffect, useState } from 'react';
import { api, ApplicationCard, JobSummary, Pipeline } from '@/lib/api';
import { JobHeader } from '@/components/JobHeader';
import { JobProvider } from './JobContext';

type JobWithApplications = JobSummary & {
  pipeline: Pipeline;
  applications: ApplicationCard[];
};

/**
 * Layout for all job-detail tabs (Candidates / Summary / Activities / …).
 *
 * Fetches the job once and exposes it through `JobProvider`, then always
 * renders the shared `JobHeader` (title + status pills + summary tiles + tab
 * nav) above the selected tab. The Candidates tab updates `liveApplications`
 * through context so the header tiles stay in sync with realtime moves.
 */
export default function JobLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const [data, setData] = useState<JobWithApplications | null>(null);
  const [live, setLive] = useState<ApplicationCard[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    api<JobWithApplications>(`/jobs/${params.id}`)
      .then((j) => {
        if (cancelled) return;
        setData(j);
        setLive(j.applications ?? []);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e.message ?? 'Failed to load job');
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (err) return <p className="p-6 text-sm text-red-700">{err}</p>;
  if (!data) return <p className="p-6 text-sm text-slate-500">Loading…</p>;

  return (
    <JobProvider
      value={{
        job: data,
        pipeline: data.pipeline,
        initialApplications: data.applications ?? [],
        liveApplications: live,
        setLiveApplications: setLive,
      }}
    >
      <div className="flex h-full flex-col">
        <JobHeader job={data} pipeline={data.pipeline} applications={live} />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </JobProvider>
  );
}
