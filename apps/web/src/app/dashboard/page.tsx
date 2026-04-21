'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, JobSummary } from '@/lib/api';
import { useAuth } from '@/lib/store';

export default function JobsPage() {
  const { activeAccountId } = useAuth();
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!activeAccountId) return;
    setJobs(null);
    setErr(null);
    api<{ jobs: JobSummary[] }>('/jobs')
      .then((r) => setJobs(r.jobs ?? (r as any)))
      .catch((e) => setErr(e.message ?? 'Failed to load jobs'));
  }, [activeAccountId]);

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Jobs</h1>
      </div>
      {err && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{err}</p>}
      {!jobs && !err && <p className="text-sm text-slate-500">Loading…</p>}
      {jobs && jobs.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No jobs yet for this account.
        </p>
      )}
      <ul className="space-y-2" data-testid="jobs-list">
        {jobs?.map((j) => (
          <li key={j.id}>
            <Link
              href={`/dashboard/jobs/${j.id}`}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 hover:border-brand-500"
              data-testid="job-row"
            >
              <div>
                <div className="font-medium">{j.title}</div>
                <div className="text-xs text-slate-500">
                  {j.department ?? '—'} · {j.location ?? '—'}
                </div>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {j.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
