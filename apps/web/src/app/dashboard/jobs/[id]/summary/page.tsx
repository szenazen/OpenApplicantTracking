'use client';

import { useMemo } from 'react';
import { Briefcase, Building2, MapPin, Users2 } from 'lucide-react';
import { useJob } from '../JobContext';
import type { ApplicationCard, Pipeline, StatusCategory } from '@/lib/api';

/**
 * "Summary" tab — a read-only overview of the job.
 *
 * Shows:
 *   - job description / meta,
 *   - top-level metrics (total applicants, hired, in pipeline, dropped),
 *   - a pipeline funnel (count per stage, in configured order),
 *   - required skills (as chips) if the job has any.
 *
 * Uses `liveApplications` from context so counts update as the Candidates
 * tab mutates them via drag-and-drop in the same session.
 */
export default function JobSummaryPage() {
  const { job, pipeline, liveApplications } = useJob();
  const funnel = useMemo(() => buildFunnel(pipeline, liveApplications), [pipeline, liveApplications]);
  const totals = useMemo(() => buildTotals(pipeline, liveApplications), [pipeline, liveApplications]);
  const max = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <div className="overflow-auto p-6" data-testid="job-summary-page">
      <div className="grid gap-6">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800">Overview</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
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
                <Briefcase size={12} /> {humanize(job.employmentType)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Users2 size={12} /> {liveApplications.length} applicant
              {liveApplications.length === 1 ? '' : 's'}
            </span>
          </div>
          <p
            className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-slate-700"
            data-testid="job-description"
          >
            {job.description?.trim() ? job.description : <em className="text-slate-400">No description provided yet.</em>}
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Applicants" value={totals.total} tone="slate" testId="metric-total" />
          <Metric label="In pipeline" value={totals.inPipeline} tone="amber" testId="metric-inpipeline" />
          <Metric label="Hired" value={totals.hired} tone="emerald" testId="metric-hired" />
          <Metric label="Dropped" value={totals.dropped} tone="rose" testId="metric-dropped" />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="funnel">
          <h2 className="text-sm font-semibold text-slate-800">Pipeline funnel</h2>
          <ol className="mt-3 space-y-2">
            {funnel.map((row) => (
              <li key={row.id} className="flex items-center gap-3">
                <span className="w-48 truncate text-xs text-slate-600">{row.name}</span>
                <div className="relative h-5 flex-1 rounded bg-slate-100">
                  <div
                    className={`absolute inset-y-0 left-0 rounded ${barColor(row.category)}`}
                    style={{ width: `${(row.count / max) * 100}%` }}
                  />
                </div>
                <span className="w-10 text-right text-xs font-semibold tabular-nums text-slate-700">
                  {row.count}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {(job.requiredSkills?.length ?? job.requiredSkillIds?.length ?? 0) > 0 && (
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800">Required skills</h2>
            <p className="mt-1 text-xs text-slate-500">
              Used by Recommendations to score candidates against this job.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5" data-testid="required-skills">
              {(job.requiredSkills && job.requiredSkills.length > 0
                ? job.requiredSkills
                : (job.requiredSkillIds ?? []).map((id) => ({ id, name: id }))
              ).map((s) => (
                <span
                  key={s.id}
                  className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200"
                >
                  {s.name}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

interface FunnelRow {
  id: string;
  name: string;
  category: StatusCategory;
  count: number;
}

function buildFunnel(pipeline: Pipeline, apps: ApplicationCard[]): FunnelRow[] {
  const perStatus = new Map<string, number>();
  for (const a of apps) perStatus.set(a.currentStatusId, (perStatus.get(a.currentStatusId) ?? 0) + 1);
  return pipeline.statuses
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, name: s.name, category: s.category, count: perStatus.get(s.id) ?? 0 }));
}

interface Totals {
  total: number;
  hired: number;
  inPipeline: number;
  dropped: number;
}

function buildTotals(pipeline: Pipeline, apps: ApplicationCard[]): Totals {
  const catByStatusId = new Map(pipeline.statuses.map((s) => [s.id, s.category] as const));
  const t: Totals = { total: apps.length, hired: 0, inPipeline: 0, dropped: 0 };
  for (const a of apps) {
    const c = catByStatusId.get(a.currentStatusId);
    if (c === 'HIRED') t.hired++;
    else if (c === 'DROPPED') t.dropped++;
    else t.inPipeline++;
  }
  return t;
}

function barColor(cat: StatusCategory): string {
  if (cat === 'HIRED') return 'bg-emerald-500';
  if (cat === 'DROPPED') return 'bg-rose-400';
  return 'bg-brand-500';
}

function Metric({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'amber' | 'emerald' | 'rose';
  testId: string;
}) {
  const tones: Record<typeof tone, string> = {
    slate: 'border-slate-200 text-slate-700',
    amber: 'border-amber-200 text-amber-800',
    emerald: 'border-emerald-200 text-emerald-800',
    rose: 'border-rose-200 text-rose-800',
  };
  return (
    <div className={`rounded-lg border bg-white p-4 shadow-sm ${tones[tone]}`} data-testid={testId}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function humanize(v: string): string {
  const lower = v.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
