'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ActivitySquare,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Briefcase,
  CheckCircle2,
  Clock,
  PieChart,
  Star,
  ThumbsUp,
  Users,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, HomeSummary, JobListResponse, JobStatus, JobSummary } from '@/lib/api';
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
 * The full requisitions index moved to `/dashboard/jobs`. A compact
 * "Recent jobs" block stays at the bottom as a quick-jump list — it also
 * preserves the `jobs-list` / `job-row` testids that many existing e2e
 * specs rely on for navigation, so we didn't have to touch those tests.
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
      // The jobs endpoint now returns `{ items, nextCursor }`. We only
      // need a short preview on the home page (the full index lives at
      // /dashboard/jobs) so a hard-capped limit is enough.
      api<JobListResponse>('/jobs?limit=10'),
    ])
      .then(([h, j]) => {
        if (cancelled) return;
        setHome(h);
        setJobs(j.items);
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

      {/* ---------------- Performance + My jobs donut ---------------------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="My performance"
          subtitle={
            home
              ? `Your activity in the last ${home.performance.windowDays} days. Owned is a live snapshot.`
              : ''
          }
          icon={BarChart3}
          testId="home-performance"
          className="lg:col-span-2"
        >
          {home && <PerformanceBarChart perf={home.performance} />}
        </Panel>
        <Panel
          title="My jobs"
          subtitle="Distribution by status."
          icon={PieChart}
          testId="home-jobs-donut"
        >
          {home && <JobsDonut byStatus={home.jobs.byStatus} total={home.jobs.total} />}
        </Panel>
      </div>

      {/* ---------------- Recent actions ---------------------------------- */}
      {home &&
        (home.recentTouched.candidates.length > 0 || home.recentTouched.jobs.length > 0) && (
          <Panel
            title="Recent actions"
            subtitle="Candidates and jobs you've touched most recently."
            icon={Clock}
            testId="home-recent-touched"
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Candidates
                </h3>
                {home.recentTouched.candidates.length === 0 ? (
                  <EmptyHint>No recent candidate activity.</EmptyHint>
                ) : (
                  <ul
                    className="flex flex-wrap gap-2"
                    data-testid="home-recent-candidates"
                  >
                    {home.recentTouched.candidates.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/dashboard/candidates?openCandidate=${c.id}`}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:border-brand-400"
                          data-testid="recent-candidate"
                        >
                          <Avatar name={`${c.firstName} ${c.lastName}`} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-800">
                              {c.firstName} {c.lastName}
                            </div>
                            {c.headline && (
                              <div className="truncate text-[10px] text-slate-500">
                                {c.headline}
                              </div>
                            )}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Jobs
                </h3>
                {home.recentTouched.jobs.length === 0 ? (
                  <EmptyHint>No recent job activity.</EmptyHint>
                ) : (
                  <ul className="flex flex-wrap gap-2" data-testid="home-recent-jobs">
                    {home.recentTouched.jobs.map((j) => (
                      <li key={j.id}>
                        <Link
                          href={`/dashboard/jobs/${j.id}`}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:border-brand-400"
                          data-testid="recent-job"
                        >
                          <JobLogo name={j.clientName ?? j.title} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-slate-800">
                              {j.title}
                            </div>
                            {j.clientName && (
                              <div className="truncate text-[10px] text-slate-500">
                                {j.clientName}
                              </div>
                            )}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Panel>
        )}

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

      {/* ---------------- Recent jobs (quick-jump + e2e compat) ------------ */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-800">Recent jobs</h2>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {home && (
              <span>
                {home.jobs.byStatus.PUBLISHED ?? 0} published · {home.jobs.total} total
              </span>
            )}
            <Link
              href="/dashboard/jobs"
              className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
              data-testid="home-view-all-jobs"
            >
              View all <ArrowRight size={12} />
            </Link>
          </div>
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
  icon: LucideIcon;
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
  className,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  children: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className ?? ''}`}
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

/**
 * Minimal SVG bar chart for the "My performance" widget. We deliberately
 * don't pull in a charting library — five bars is not worth the ~60KB of
 * recharts and skipping it keeps LCP snappy. The numbers are rendered as
 * text above each bar so screen readers still get the information.
 */
function PerformanceBarChart({
  perf,
}: {
  perf: HomeSummary['performance'];
}) {
  const bars: Array<{ key: keyof HomeSummary['performance']; label: string; value: number }> = [
    { key: 'created', label: 'Created', value: perf.created },
    { key: 'owned', label: 'Owned', value: perf.owned },
    { key: 'addedToJob', label: 'Added to a job', value: perf.addedToJob },
    { key: 'dropped', label: 'Dropped', value: perf.dropped },
    { key: 'placed', label: 'Placed', value: perf.placed },
  ];
  const max = Math.max(1, ...bars.map((b) => b.value));
  // Round the max up to a "nice" gridline so ticks aren't ugly (e.g. 17 -> 20).
  const nice = niceCeiling(max);
  const ticks = [0, Math.round(nice / 4), Math.round(nice / 2), Math.round((nice * 3) / 4), nice];
  return (
    <div data-testid="perf-chart">
      <div className="relative h-52 pl-8 pr-2">
        {/* y-axis gridlines */}
        <div className="absolute inset-y-0 left-0 right-2 flex flex-col-reverse justify-between">
          {ticks.map((t) => (
            <div key={t} className="flex items-center">
              <span className="w-7 pr-1 text-right text-[10px] text-slate-400">{t}</span>
              <div className="h-px flex-1 bg-slate-100" />
            </div>
          ))}
        </div>
        {/* bars */}
        <div className="absolute inset-y-0 left-8 right-2 flex items-end gap-4">
          {bars.map((b) => {
            const heightPct = (b.value / nice) * 100;
            return (
              <div
                key={b.key}
                className="flex h-full flex-1 flex-col items-center justify-end"
                data-testid={`perf-bar-${b.key}`}
              >
                <span className="mb-1 text-[11px] font-medium text-slate-600">{b.value}</span>
                <div
                  className="w-full max-w-[44px] rounded-t bg-brand-500"
                  style={{ height: `${Math.max(heightPct, b.value > 0 ? 2 : 0)}%` }}
                  aria-label={`${b.label}: ${b.value}`}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex gap-4 pl-8 pr-2 text-center text-[11px] text-slate-500">
        {bars.map((b) => (
          <div key={b.key} className="flex-1 truncate">
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Rounds a value up to the next "nice" integer for chart ticks.
 * Prefers multiples of 2, 5 or 10 of the right magnitude so gridlines
 * land on readable numbers.
 */
function niceCeiling(n: number): number {
  if (n <= 1) return 1;
  if (n <= 4) return 4;
  if (n <= 10) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(n)));
  const candidates = [1, 2, 2.5, 5, 10].map((c) => c * pow);
  for (const c of candidates) if (c >= n) return c;
  return candidates[candidates.length - 1] ?? n;
}

/**
 * Donut rendering of job distribution by status. We collapse the five
 * raw statuses into four user-facing buckets (Active / Won / Lost / On
 * hold) to match how recruiters talk about their book of work.
 */
function JobsDonut({
  byStatus,
  total,
}: {
  byStatus: Record<JobStatus, number>;
  total: number;
}) {
  const slices = useMemo(
    () => [
      { key: 'active', label: 'Active', value: byStatus.PUBLISHED ?? 0, color: '#2563eb' },
      { key: 'won', label: 'Won', value: byStatus.CLOSED ?? 0, color: '#10b981' },
      { key: 'lost', label: 'Lost', value: byStatus.ARCHIVED ?? 0, color: '#ef4444' },
      { key: 'onHold', label: 'On hold', value: byStatus.ON_HOLD ?? 0, color: '#f59e0b' },
      { key: 'draft', label: 'Draft', value: byStatus.DRAFT ?? 0, color: '#94a3b8' },
    ],
    [byStatus],
  );
  const sum = slices.reduce((acc, s) => acc + s.value, 0);
  // Single cumulative angle sweep — SVG arcs composed of two points each.
  // Kept handwritten so we don't have to pull in recharts for a donut.
  const radius = 54;
  const cx = 70;
  const cy = 70;
  const stroke = 18;
  let offset = 0;
  const paths = slices.map((s) => {
    const pct = sum === 0 ? 0 : s.value / sum;
    const circumference = 2 * Math.PI * radius;
    const dash = pct * circumference;
    const node = (
      <circle
        key={s.key}
        r={radius}
        cx={cx}
        cy={cy}
        fill="transparent"
        stroke={s.color}
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={-offset}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    );
    offset += dash;
    return node;
  });
  return (
    <div className="flex items-center gap-4">
      <svg width={140} height={140} viewBox="0 0 140 140" role="img" aria-label="Jobs by status">
        {sum === 0 ? (
          <circle r={radius} cx={cx} cy={cy} fill="transparent" stroke="#e2e8f0" strokeWidth={stroke} />
        ) : (
          paths
        )}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="fill-slate-900"
          style={{ fontSize: 18, fontWeight: 600 }}
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          className="fill-slate-500"
          style={{ fontSize: 10 }}
        >
          jobs
        </text>
      </svg>
      <ul className="space-y-1 text-xs">
        {slices
          .filter((s) => s.value > 0)
          .map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: s.color }}
              />
              <span className="text-slate-700">{s.label}</span>
              <span className="text-slate-400">· {s.value}</span>
            </li>
          ))}
        {sum === 0 && <li className="text-slate-500">No jobs yet.</li>}
      </ul>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700"
      aria-hidden
    >
      {initials || '?'}
    </div>
  );
}

function JobLogo({ name }: { name: string }) {
  const letter = (name || '?').trim()[0]?.toUpperCase() ?? '?';
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-slate-700 ring-1 ring-inset ring-slate-200"
      aria-hidden
    >
      {letter}
    </div>
  );
}
