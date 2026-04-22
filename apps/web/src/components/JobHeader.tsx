'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeft, Briefcase, Building2, MapPin } from 'lucide-react';
import { api, ApiError, type ApplicationCard, type JobMember, type JobStatus, type JobSummary, type Pipeline } from '@/lib/api';
import { useJob } from '@/app/dashboard/jobs/[id]/JobContext';
import { EditJobDialog } from './EditJobDialog';
import { JobActionsMenu } from './JobActionsMenu';

interface Props {
  job: JobSummary;
  pipeline: Pipeline;
  applications: ApplicationCard[];
  members?: JobMember[];
}

interface TabDef {
  label: string;
  /** Sub-path under `/dashboard/jobs/[id]` — '' means Candidates (root). */
  subpath: string;
  badge?: number;
  testId?: string;
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
export function JobHeader({ job, pipeline, applications, members }: Props) {
  const counts = useMemo(() => summarize(pipeline, applications), [pipeline, applications]);
  const pathname = usePathname() ?? '';
  const { patchJob } = useJob();
  const [editOpen, setEditOpen] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  async function changeStatus(next: JobStatus) {
    // Optimistic + reconcile. Failure surfaces a dismissible toast-lite in
    // the header; full snackbar UX is covered by Phase 4 (notifications).
    const prev = job.status;
    patchJob({ status: next });
    try {
      await api(`/jobs/${job.id}`, { method: 'PATCH', body: { status: next } });
    } catch (e) {
      patchJob({ status: prev });
      setStatusErr(e instanceof ApiError ? e.message : 'Failed to change status');
      setTimeout(() => setStatusErr(null), 4000);
    }
  }
  const jobRoot = `/dashboard/jobs/${job.id}`;
  const tabs: TabDef[] = [
    { label: 'Candidates', subpath: '', badge: applications.length, testId: 'tab-candidates' },
    { label: 'Summary', subpath: '/summary', testId: 'tab-summary' },
    { label: 'Team', subpath: '/team', badge: members?.length, testId: 'tab-team' },
    { label: 'Recommendations', subpath: '/recommendations', testId: 'tab-recommendations' },
    { label: 'Activities', subpath: '/activities', testId: 'tab-activities' },
    { label: 'Notes', subpath: '/notes', testId: 'tab-notes' },
    { label: 'Attachments', subpath: '/attachments', testId: 'tab-attachments' },
    { label: 'Sourcing', subpath: '/sourcing', testId: 'tab-sourcing' },
    { label: 'Reports', subpath: '/reports', testId: 'tab-reports' },
  ];

  return (
    <div className="border-b border-slate-200 bg-white px-6 pt-3">
      <Link
        href="/dashboard/jobs"
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
            {members && members.length > 0 && <TeamChips members={members} jobRoot={jobRoot} />}
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
          <JobActionsMenu
            job={job}
            pipeline={pipeline}
            applications={applications}
            onEdit={() => setEditOpen(true)}
            onStatusChange={changeStatus}
          />
        </div>
      </div>

      {statusErr && (
        <div
          role="alert"
          className="mt-2 inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700 ring-1 ring-inset ring-rose-200"
          data-testid="job-status-error"
        >
          {statusErr}
        </div>
      )}

      <EditJobDialog
        job={job}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(next) => patchJob(next)}
      />

      <nav className="mt-3 -mb-px flex items-center gap-4 overflow-x-auto text-sm" aria-label="Job sections">
        {tabs.map((t) => {
          const href = jobRoot + t.subpath;
          const active = t.subpath === '' ? pathname === jobRoot : pathname.startsWith(href);
          return (
            <TabLink
              key={t.label}
              label={t.label}
              href={href}
              badge={t.badge}
              active={active}
              testId={t.testId}
            />
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Compact stacked-avatar chip group linking to the Team tab.
 *
 * Shows up to 4 avatars; overflow is rendered as a "+N" chip so large teams
 * don't bloat the header. The whole row is a link so a single click jumps to
 * the full team management UI.
 */
function TeamChips({ members, jobRoot }: { members: JobMember[]; jobRoot: string }) {
  const visible = members.slice(0, 4);
  const overflow = members.length - visible.length;
  return (
    <Link
      href={`${jobRoot}/team`}
      className="group inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-1.5 py-0.5 hover:bg-slate-50"
      aria-label={`Team: ${members.length} member${members.length === 1 ? '' : 's'}`}
      data-testid="team-chips"
    >
      <span className="-space-x-1.5 flex items-center">
        {visible.map((m) => (
          <TeamAvatar key={m.id} member={m} />
        ))}
      </span>
      {overflow > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-600 ring-2 ring-white">
          +{overflow}
        </span>
      )}
      <span className="text-[11px] font-medium text-slate-600 group-hover:text-slate-800">
        {members.length} on team
      </span>
    </Link>
  );
}

function TeamAvatar({ member }: { member: JobMember }) {
  const name = member.user?.displayName ?? member.user?.email ?? '?';
  const initials = name
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  const title = `${name} — ${humanizeRole(member.role)}`;
  if (member.user?.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={member.user.avatarUrl}
        alt={name}
        title={title}
        className="h-5 w-5 rounded-full object-cover ring-2 ring-white"
      />
    );
  }
  return (
    <span
      title={title}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[9px] font-semibold text-brand-700 ring-2 ring-white"
    >
      {initials || '?'}
    </span>
  );
}

function humanizeRole(role: string): string {
  return role
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
  href,
  badge,
  active,
  testId,
}: {
  label: string;
  href: string;
  badge?: number;
  active?: boolean;
  testId?: string;
}) {
  const base = 'inline-flex items-center gap-1 whitespace-nowrap border-b-2 px-1 pb-2 pt-1 transition-colors';
  const state = active
    ? 'border-brand-600 text-brand-700 font-semibold'
    : 'border-transparent text-slate-600 hover:text-slate-900';
  return (
    <Link
      href={href}
      className={`${base} ${state}`}
      aria-current={active ? 'page' : undefined}
      data-testid={testId}
    >
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
    </Link>
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
