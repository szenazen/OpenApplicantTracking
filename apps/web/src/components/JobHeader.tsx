'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowLeft, Briefcase, Building2, MapPin, MoreHorizontal } from 'lucide-react';
import type { ApplicationCard, JobSummary, Pipeline } from '@/lib/api';

interface Props {
  job: JobSummary;
  pipeline: Pipeline;
  applications: ApplicationCard[];
}

/**
 * Top-of-page header for the job Kanban view.
 *
 * Layout (matches `design/kanban-reference.png`):
 *   - Left: back link, job title with status + "top category" pills, meta row
 *     (department / location / employment type).
 *   - Right: three pipeline summary tiles — Hired / In pipeline / Dropped —
 *     computed from the current applications' status categories so they stay
 *     in sync with realtime moves.
 *   - Below: a secondary tab bar with Candidates active (other tabs shown as
 *     disabled placeholders for now — they are on the roadmap).
 */
export function JobHeader({ job, pipeline, applications }: Props) {
  const counts = useMemo(() => summarize(pipeline, applications), [pipeline, applications]);

  return (
    <div className="border-b border-slate-200 bg-white px-6 pt-3">
      <Link
        href="/dashboard"
        className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={12} /> back to jobs
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight" data-testid="job-title">
              {job.title}
            </h1>
            <JobStatusPill status={job.status} />
            {counts.hired > 0 && (
              <span
                className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
                data-testid="pill-hired"
              >
                Hired
              </span>
            )}
          </div>
          <div
            className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500"
            data-testid="job-meta"
          >
            {job.department && (
              <span className="inline-flex items-center gap-1">
                <Building2 size={12} /> {job.department}
              </span>
            )}
            {job.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} /> {job.location}
              </span>
            )}
            {job.employmentType && (
              <span className="inline-flex items-center gap-1">
                <Briefcase size={12} /> {humanizeEmploymentType(job.employmentType)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-stretch gap-2" data-testid="job-summary">
          <SummaryTile label="Hired" value={counts.hired} tone="success" testId="summary-hired" />
          <SummaryTile
            label="In pipeline"
            value={counts.inPipeline}
            tone="info"
            testId="summary-in-pipeline"
          />
          <SummaryTile label="Dropped" value={counts.dropped} tone="danger" testId="summary-dropped" />
          <button
            type="button"
            aria-label="Job actions"
            className="self-start rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <nav className="mt-3 -mb-px flex items-center gap-4 overflow-x-auto text-sm" aria-label="Job sections">
        <TabLink active label="Candidates" badge={applications.length} testId="tab-candidates" />
        <TabLink label="Summary" disabled />
        <TabLink label="Activities" disabled />
        <TabLink label="Notes" disabled />
        <TabLink label="Attachments" disabled />
      </nav>
    </div>
  );
}

function JobStatusPill({ status }: { status: string }) {
  const cls = JOB_STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}
      data-testid="job-status-pill"
    >
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

const JOB_STATUS_STYLES: Record<string, string> = {
  PUBLISHED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-200',
  ON_HOLD: 'bg-amber-50 text-amber-700 ring-amber-200',
  CLOSED: 'bg-slate-200 text-slate-700 ring-slate-300',
  ARCHIVED: 'bg-slate-200 text-slate-700 ring-slate-300',
};

function humanizeEmploymentType(t: string): string {
  // "FULL_TIME" -> "Full time"
  const lower = t.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function SummaryTile({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: number;
  tone: 'success' | 'info' | 'danger';
  testId: string;
}) {
  const TONE: Record<typeof tone, { header: string; wrap: string }> = {
    success: { header: 'bg-emerald-500 text-white', wrap: 'border-emerald-200' },
    info: { header: 'bg-amber-400 text-white', wrap: 'border-amber-200' },
    danger: { header: 'bg-rose-500 text-white', wrap: 'border-rose-200' },
  };
  const t = TONE[tone];
  return (
    <div
      className={`flex min-w-[72px] flex-col overflow-hidden rounded-md border ${t.wrap}`}
      data-testid={testId}
    >
      <span className={`px-2 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide ${t.header}`}>
        {label}
      </span>
      <span className="bg-white px-2 py-1 text-center text-sm font-semibold text-slate-700">{value}</span>
    </div>
  );
}

function TabLink({
  label,
  badge,
  active,
  disabled,
  testId,
}: {
  label: string;
  badge?: number;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const base = 'inline-flex items-center gap-1 whitespace-nowrap border-b-2 px-1 pb-2 pt-1 transition-colors';
  const state = active
    ? 'border-brand-600 text-brand-700 font-semibold'
    : disabled
      ? 'border-transparent text-slate-400 cursor-not-allowed'
      : 'border-transparent text-slate-600 hover:text-slate-900';
  return (
    <span className={`${base} ${state}`} aria-current={active ? 'page' : undefined} data-testid={testId}>
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className={
            'rounded-full px-1.5 py-0.5 text-[10px] font-semibold ' +
            (active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600')
          }
        >
          {badge}
        </span>
      )}
    </span>
  );
}

interface Counts {
  hired: number;
  inPipeline: number;
  dropped: number;
}

/**
 * Group counts by pipeline status category:
 *   HIRED          -> "Hired"
 *   DROPPED        -> "Dropped"
 *   NEW / IN_PROGRESS / anything else -> "In pipeline"
 */
function summarize(pipeline: Pipeline, applications: ApplicationCard[]): Counts {
  const catByStatusId = new Map(pipeline.statuses.map((s) => [s.id, s.category] as const));
  const counts: Counts = { hired: 0, inPipeline: 0, dropped: 0 };
  for (const a of applications) {
    const cat = catByStatusId.get(a.currentStatusId);
    if (cat === 'HIRED') counts.hired++;
    else if (cat === 'DROPPED') counts.dropped++;
    else counts.inPipeline++;
  }
  return counts;
}
