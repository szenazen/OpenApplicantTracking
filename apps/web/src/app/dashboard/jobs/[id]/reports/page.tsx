'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  api,
  apiText,
  type FunnelEntry,
  type HiresOverTimeEntry,
  type JobReport,
  type StageDropOffEntry,
  type TimeInStageEntry,
} from '@/lib/api';
import { useJob } from '../JobContext';

const WINDOW_OPTIONS = [7, 30, 90] as const;

function normalizeReportPayload(res: JobReport): JobReport {
  const emptyTotals = { applications: 0, hired: 0, dropped: 0, inProgress: 0 };
  const emptyRates = {
    hiredOfApplicantsPct: null,
    droppedOfApplicantsPct: null,
    inPipelineOfApplicantsPct: null,
  };
  return {
    ...res,
    funnel: res.funnel ?? [],
    timeInStage: res.timeInStage ?? [],
    hiresOverTime: res.hiresOverTime ?? { windowDays: 30, series: [] },
    totals: res.totals ?? emptyTotals,
    rates: res.rates ?? emptyRates,
    stageDropOff: res.stageDropOff ?? [],
  };
}

/**
 * "Reports" tab — job-scoped analytics.
 *
 * Layout (matches the dashboard feel in `design/kanban-reference.png`):
 *   - Four KPI tiles (total / in-progress / hired / dropped).
 *   - Funnel bar chart per pipeline stage.
 *   - Time-in-stage bars (human-readable durations).
 *   - Hires over time sparkline with day labels on the x-axis.
 *
 * Charts are inline SVGs — no external charting dep — to keep the bundle
 * small and because the data volumes here are tiny (per-job, <= 1 yr).
 */
export default function JobReportsPage() {
  const { job } = useJob();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<JobReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const res = await api<JobReport>(`/jobs/${job.id}/reports?days=${days}`);
        if (!cancelled) setData(normalizeReportPayload(res));
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Failed to load report');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [job.id, days]);

  return (
    <div className="overflow-auto p-6" data-testid="job-reports-page">
      <div className="max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
              <BarChart3 size={14} className="text-brand-600" /> Reports
            </h2>
            <p className="text-xs text-slate-500">
              Funnel health, drop-off by stage, conversion rates, dwell time, and hires over time.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                const csv = await apiText(`/jobs/${job.id}/reports/csv?days=${days}`);
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `job-${job.id}-report.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              data-testid="reports-export-csv"
            >
              Export CSV
            </button>
            <div className="flex items-center gap-1 rounded-md bg-slate-100 p-0.5 text-xs">
              {WINDOW_OPTIONS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setDays(w)}
                  className={`rounded px-2 py-1 font-medium transition-colors ${
                    days === w ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                  data-testid={`reports-window-${w}`}
                >
                  {w}d
                </button>
              ))}
            </div>
          </div>
        </header>

        {err && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            {err}
          </p>
        )}

        {loading && !data ? (
          <p className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
            Loading…
          </p>
        ) : !data ? null : (
          <>
            <KpiRow totals={data.totals} rates={data.rates} />
            <Card
              title="Conversion & drop-off"
              subtitle="Share of applicants hired / dropped / in pipeline, and exits from each stage"
            >
              <DropOffTable rows={data.stageDropOff} rates={data.rates} />
            </Card>
            <Card title="Funnel" subtitle="Applications currently in each stage">
              <FunnelChart funnel={data.funnel} />
            </Card>
            <Card title="Time in stage" subtitle="Average time applications spent in each stage before moving on">
              <TimeInStageChart items={data.timeInStage} />
            </Card>
            <Card title="Hires over time" subtitle={`Daily hire transitions over the last ${data.hiresOverTime.windowDays} days`}>
              <HiresOverTimeChart series={data.hiresOverTime.series} />
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function KpiRow({ totals, rates }: { totals: JobReport['totals']; rates: JobReport['rates'] }) {
  const tiles: Array<{ label: string; value: number; tone: string; testId: string }> = [
    { label: 'Applications', value: totals.applications, tone: 'text-slate-800', testId: 'kpi-applications' },
    { label: 'In pipeline', value: totals.inProgress, tone: 'text-sky-700', testId: 'kpi-in-progress' },
    { label: 'Hired', value: totals.hired, tone: 'text-emerald-700', testId: 'kpi-hired' },
    { label: 'Dropped', value: totals.dropped, tone: 'text-rose-700', testId: 'kpi-dropped' },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            data-testid={t.testId}
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{t.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${t.tone}`}>{t.value}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500" data-testid="reports-rates">
        Conversion:{' '}
        <span className="font-medium text-emerald-700">
          {rates.hiredOfApplicantsPct != null ? `${rates.hiredOfApplicantsPct}% hired` : '—'}
        </span>
        {' · '}
        <span className="font-medium text-rose-600">
          {rates.droppedOfApplicantsPct != null ? `${rates.droppedOfApplicantsPct}% dropped` : '—'}
        </span>
        {' · '}
        <span className="font-medium text-sky-700">
          {rates.inPipelineOfApplicantsPct != null ? `${rates.inPipelineOfApplicantsPct}% in pipeline` : '—'}
        </span>
      </p>
    </div>
  );
}

function DropOffTable({
  rows,
  rates,
}: {
  rows: StageDropOffEntry[];
  rates: JobReport['rates'];
}) {
  const withExits = rows.filter((r) => r.exitTotal > 0);
  if (withExits.length === 0) {
    return (
      <p className="text-xs text-slate-400" data-testid="reports-dropoff">
        No stage exits recorded yet — move some cards to see drop-off.
      </p>
    );
  }
  return (
    <div data-testid="reports-dropoff">
      <ul className="space-y-2">
        {withExits.map((r) => (
          <li
            key={r.statusId}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs sm:grid-cols-[10rem_1fr_auto]"
          >
            <span className="truncate font-medium text-slate-700" title={r.name}>
              {r.name}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              {r.dropOffRatePct != null && (
                <div
                  className="h-full rounded-full bg-rose-400"
                  style={{ width: `${Math.min(100, r.dropOffRatePct)}%` }}
                  title={`${r.dropOffRatePct}% dropped when leaving this stage`}
                />
              )}
            </div>
            <span className="text-right tabular-nums text-slate-600">
              {r.droppedCount}/{r.exitTotal} dropped
              {r.dropOffRatePct != null && (
                <span className="ml-1 text-rose-600">({r.dropOffRatePct}%)</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-slate-400">
        Rates row: {rates.hiredOfApplicantsPct ?? '—'}% hired of applicants (snapshot).
      </p>
    </div>
  );
}

function FunnelChart({ funnel }: { funnel: FunnelEntry[] }) {
  const max = useMemo(() => Math.max(1, ...funnel.map((f) => f.count)), [funnel]);
  if (funnel.length === 0) {
    return <p className="text-xs text-slate-400">No stages configured.</p>;
  }
  return (
    <ul className="space-y-2" data-testid="funnel-chart">
      {funnel.map((f) => {
        const pct = Math.round((f.count / max) * 100);
        return (
          <li key={f.statusId} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3 text-xs">
            <span className="truncate text-slate-700" title={f.name}>
              {f.name}
              <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400">{f.category}</span>
            </span>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${categoryBarColor(f.category)}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-right tabular-nums text-slate-700">{f.count}</span>
          </li>
        );
      })}
    </ul>
  );
}

function categoryBarColor(category: string): string {
  switch (category) {
    case 'HIRED':
      return 'bg-emerald-500';
    case 'DROPPED':
      return 'bg-rose-400';
    case 'NEW':
      return 'bg-sky-400';
    default:
      return 'bg-brand-500';
  }
}

function TimeInStageChart({ items }: { items: TimeInStageEntry[] }) {
  const max = useMemo(
    () => Math.max(1, ...items.map((i) => i.avgSeconds ?? 0)),
    [items],
  );
  if (items.length === 0) return <p className="text-xs text-slate-400">No stages configured.</p>;
  return (
    <ul className="space-y-2" data-testid="time-in-stage-chart">
      {items.map((i) => {
        const pct = i.avgSeconds ? Math.round((i.avgSeconds / max) * 100) : 0;
        return (
          <li key={i.statusId} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-3 text-xs">
            <span className="truncate text-slate-700">{i.name}</span>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-right tabular-nums text-slate-700">
              {i.avgSeconds == null ? '—' : humanizeDuration(i.avgSeconds)}
              {i.sampleSize > 0 && (
                <span className="ml-1 text-[10px] text-slate-400">(n={i.sampleSize})</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function humanizeDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = seconds / 60;
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = mins / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  const days = hours / 24;
  return `${days.toFixed(1)}d`;
}

function HiresOverTimeChart({ series }: { series: HiresOverTimeEntry[] }) {
  const total = useMemo(() => series.reduce((sum, s) => sum + s.count, 0), [series]);
  const max = Math.max(1, ...series.map((s) => s.count));

  if (series.length === 0) {
    return <p className="text-xs text-slate-400">No data yet.</p>;
  }

  // Inline SVG sparkline-style bar chart. Keeps us dep-free.
  const width = 100; // viewBox units
  const height = 28;
  const barW = width / series.length;
  return (
    <div data-testid="hires-over-time-chart">
      <div className="flex items-end justify-between">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-20 w-full">
          {series.map((p, idx) => {
            const h = (p.count / max) * (height - 2);
            return (
              <rect
                key={p.date}
                x={idx * barW + 0.2}
                y={height - h}
                width={barW - 0.4}
                height={h}
                fill={p.count > 0 ? '#10b981' : '#e2e8f0'}
              >
                <title>
                  {p.date}: {p.count}
                </title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{series[0]?.date}</span>
        <span className="font-medium text-slate-600">{total} hires</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}
