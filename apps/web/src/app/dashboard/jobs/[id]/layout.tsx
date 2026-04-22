'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApplicationCard, JobMember, JobSummary, Pipeline } from '@/lib/api';
import { JobHeader } from '@/components/JobHeader';
import { JobProvider } from './JobContext';

type JobWithApplications = JobSummary & {
  pipeline: Pipeline;
  applications: ApplicationCard[];
  members?: JobMember[];
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
  const [members, setMembers] = useState<JobMember[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const idRef = useRef(params.id);
  idRef.current = params.id;

  const refreshJob = useCallback(async () => {
    const fetchId = idRef.current;
    try {
      const j = await api<JobWithApplications>(`/jobs/${fetchId}`);
      if (idRef.current !== fetchId) return;
      setData(j);
      setLive(j.applications ?? []);
      setMembers(j.members ?? []);
      setErr(null);
    } catch (e) {
      console.warn('[JobLayout] refreshJob failed', e);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    api<JobWithApplications>(`/jobs/${params.id}`)
      .then((j) => {
        if (cancelled) return;
        setData(j);
        setLive(j.applications ?? []);
        setMembers(j.members ?? []);
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
  // Avoid one frame (or more) of the *previous* job's payload after `params.id`
  // changes — React runs effects after paint, so `data` can still reference
  // the old requisition until the new fetch settles.
  if (!data || data.id !== params.id) return <p className="p-6 text-sm text-slate-500">Loading…</p>;

  const patchJob = (patch: Partial<JobSummary>) => {
    setData((d) => (d ? { ...d, ...patch } : d));
  };

  return (
    <JobProvider
      value={{
        job: data,
        pipeline: data.pipeline,
        initialApplications: data.applications ?? [],
        liveApplications: live,
        setLiveApplications: setLive,
        members,
        setMembers,
        patchJob,
        refreshJob,
      }}
    >
      <div className="flex h-full flex-col">
        <JobHeader
          job={data}
          pipeline={data.pipeline}
          applications={live}
          members={members}
        />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
    </JobProvider>
  );
}
