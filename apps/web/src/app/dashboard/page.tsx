'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ActivitySquare,
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Clock,
  Star,
  ThumbsUp,
  Users,
  XCircle,
} from 'lucide-react';
import { api, HomeSummary, JobSummary } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { formatRelativeDuration } from '@/lib/format';

/**
 * Recruiter home — the landing page after sign-in.
 *
 * Reframes the old "flat list of jobs" view around the three things a
 * recruiter scans first thing in the morning:
 *
 *   1. Pipeline health tiles (open jobs, in pipeline, hires/drops this
 *      week)
 *   2. "Needs your attention" — jobs with stuck cards
 *   3. Recent activity across the account
 *
 * The full jobs list still lives at the bottom (kept under the same
 * `jobs-list` / `job-row` testids that other e2e specs rely on for
 * navigation). When we add a dedicated `/dashboard/jobs` route we can
 * thin this page out, but for now keeping it discoverable here is the
 * least-disruptive option.
 */
export default function HomePage() {
  const { activeAccountId } = useAuth();
  const [home, setHome] = useState<HomeSummary | null>(null);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!activeAccountId) return;
    setHome(null);
    setJobs(null);
    setErr(null);
    let cancelled = false;
    Promise.all([
      api<HomeSummary>('/home'),
      api<{ jobs: JobSummary[] } | JobSummary[]>('/jobs'),
    ])
      .then(([h, j]) => {
        if (cancelled) return;
        setHome(h);
        setJobs(Array.isArray(j) ? j : j.jobs ?? []);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message ?? 'Failed to load dashboard');
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccountId]);

  return (
    <div className="space-y-6 p-6" data-testid="home-page">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Recruiter home</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Pipeline health and what needs your attention today.
          </p>
        </div>
      </header>

      {err && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">
          {err}
        </p>
      )}

      {/* ---------------- Stat tiles --------------------------------------- */}
      <section
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="home-stats"
      >
        <StatTile
          label="Open jobs"
          value={home?.jobs.byStatus.PUBLISHED ?? null}
          hint={
            home
              ? `${home.jobs.total} total · ${home.jobs.byStatus.ON_HOLD ?? 0} on hold`
              : undefined
          }
          icon={Briefcase}
          tone="brand"
          testId="stat-open-jobs"
        />
        <StatTile
          label="Candidates in pipeline"
          value={home?.pipeline.inPipeline ?? null}
          hint={home ? `${home.pipeline.applications} applications all-time` : undefined}
          icon={Users}
          tone="slate"
          testId="stat-in-pipeline"
        />
        <StatTile
          label={`Hires (${home?.window.recentDays ?? 7}d)`}
          value={home?.pipeline.hiresInWindow ?? null}
          hint={home ? `${home.pipeline.hiredCurrent} currently in HIRED` : undefined}
          icon={CheckCircle2}
          tone="success"
          testId="stat-hires"
        />
        <StatTile
          label={`Drops (${home?.window.recentDays ?? 7}d)`}
          value={home?.pipeline.dropsInWindow ?? null}
          hint={home ? `${home.pipeline.droppedCurrent} currently in DROPPED` : undefined}
          icon={XCircle}
          tone="danger"
          testId="stat-drops"
        />
      </section>

      {/* ---------------- Two-column: Attention + Activity ----------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Needs your attention"
          subtitle={
            home
              ? `Open jobs with cards inactive for >${home.window.stuckThresholdDays} days.`
              : ''
          }
          icon={AlertTriangle}
          testId="home-attention"
        >
          {home && home.attention.length === 0 && (
            <EmptyHint>Nothing stuck — your pipeline is moving.</EmptyHint>
          )}
          <ul className="divide-y divide-slate-100">
            {home?.attention.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/dashboard/jobs/${j.id}`}
                  className="flex items-center justify-between gap-2 px-2 py-2.5 hover:bg-amber-50/40"
                  data-testid="attention-row"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{j.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {(j.department ?? '—') + ' · ' + (j.location ?? '—')}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                      title="Cards stuck more than the threshold"
                    >
                      <Clock size={11} />
                      {j.stuckCount} stuck
                    </span>
                    <ArrowRight size={14} className="text-slate-400" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Recent activity"
          subtitle="Last 10 events across your account."
          icon={ActivitySquare}
          testId="home-activity"
        >
          {home && home.recentActivity.length === 0 && (
            <EmptyHint>No activity yet. Move a card or add a comment to get started.</EmptyHint>
          )}
          <ul className="divide-y divide-slate-100" data-testid="home-activity-list">
            {home?.recentActivity.map((e) => (
              <li key={e.id} className="px-2 py-2.5 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-slate-700">
                    <span className="font-medium text-slate-900">
                      {e.actor?.displayName ?? e.actor?.email ?? 'Someone'}
                    </span>{' '}
                    <ActivityVerb action={e.action} metadata={e.metadata} />
                  </span>
                  <time
                    className="shrink-0 text-xs text-slate-400"
                    dateTime={e.createdAt}
                    title={new Date(e.createdAt).toLocaleString()}
                  >
                    {formatRelativeDuration(e.createdAt)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* ---------------- My jobs ------------------------------------------ */}
      {home && home.myJobs.length > 0 && (
        <Panel title="My jobs" subtitle="Jobs you're a member of." icon={Star} testId="home-my-jobs">
          <ul className="divide-y divide-slate-100">
            {home.myJobs.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/dashboard/jobs/${j.id}`}
                  className="flex items-center justify-between gap-2 px-2 py-2.5 hover:bg-slate-50"
                  data-testid="my-job-row"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{j.title}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {(j.department ?? '—') + ' · ' + (j.location ?? '—')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <RolePill role={j.role} />
                    <StatusPill status={j.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ---------------- All jobs (kept for navigation + e2e) ------------- */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">All jobs</h2>
          {home && (
            <span className="text-xs text-slate-500">
              {home.jobs.byStatus.PUBLISHED ?? 0} published · {home.jobs.total} total
            </span>
          )}
        </div>
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
                <StatusPill status={j.status} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  testId,
}: {
  label: string;
  value: number | null;
  hint?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: 'brand' | 'slate' | 'success' | 'danger';
  testId?: string;
}) {
  const toneCls =
    tone === 'success'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
      : tone === 'danger'
      ? 'bg-rose-50 text-rose-700 ring-rose-100'
      : tone === 'brand'
      ? 'bg-brand-50 text-brand-700 ring-brand-100'
      : 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <div
      className="flex items-start justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid={testId}
    >
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-slate-900" data-testid={testId ? `${testId}-value` : undefined}>
          {value === null ? '—' : value}
        </div>
        {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
      </div>
      <div className={`flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-inset ${toneCls}`}>
        <Icon size={16} />
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  icon: Icon,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid={testId}
    >
      <header className="mb-2 flex items-start gap-2">
        <Icon size={16} className="mt-0.5 text-slate-500" />
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">{children}</p>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'PUBLISHED'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : status === 'CLOSED' || status === 'ARCHIVED'
      ? 'bg-slate-100 text-slate-600 ring-slate-200'
      : status === 'ON_HOLD'
      ? 'bg-amber-50 text-amber-800 ring-amber-200'
      : 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone}`}
    >
      {String(status).toLowerCase().replace(/_/g, ' ')}
    </span>
  );
}

function RolePill({ role }: { role: string | null }) {
  if (!role) return null;
  return (
    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
      {role.toLowerCase().replace(/_/g, ' ')}
    </span>
  );
}

/**
 * Lightweight verb renderer for the recent activity feed. We intentionally
 * keep this less detailed than the per-job Activities tab — at the home
 * level the user wants signal, not exhaustive context. They can click into
 * a job for the full feed.
 */
function ActivityVerb({
  action,
  metadata,
}: {
  action: string;
  metadata: Record<string, unknown>;
}) {
  switch (action) {
    case 'application.created':
      return <span>added a candidate.</span>;
    case 'application.moved': {
      const reason = typeof metadata.reason === 'string' ? metadata.reason : '';
      return (
        <span>
          moved a candidate{reason ? <span className="text-slate-500"> — {reason}</span> : ''}.
        </span>
      );
    }
    case 'comment.created':
      return <span>commented on a candidate.</span>;
    case 'comment.updated':
      return <span>edited a comment.</span>;
    case 'comment.deleted':
      return <span>deleted a comment.</span>;
    case 'reaction.added':
      return (
        <span className="inline-flex items-center gap-1">
          reacted <ThumbsUp size={11} className="text-slate-400" />.
        </span>
      );
    case 'reaction.removed':
      return <span>removed a reaction.</span>;
    case 'note.created':
      return <span>added a note.</span>;
    case 'note.updated':
      return <span>edited a note.</span>;
    case 'note.deleted':
      return <span>deleted a note.</span>;
    case 'job.updated': {
      const changed = Array.isArray(metadata.changedFields)
        ? (metadata.changedFields as string[])
        : [];
      if (changed.includes('status')) return <span>changed a job's status.</span>;
      return <span>updated a job.</span>;
    }
    case 'candidate.imported':
      return <span>imported a candidate.</span>;
    case 'job-member.added':
      return <span>added a job member.</span>;
    case 'job-member.removed':
      return <span>removed a job member.</span>;
    default:
      return <span>{action.replace(/[._]/g, ' ')}.</span>;
  }
}
