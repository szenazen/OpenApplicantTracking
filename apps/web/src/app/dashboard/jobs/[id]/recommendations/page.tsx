'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Check,
  Filter,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import {
  api,
  ApiError,
  type RecommendationsResponse,
  type RecommendedCandidate,
  type SkillRef,
} from '@/lib/api';
import { useJob } from '../JobContext';

type AddState =
  | { status: 'idle' }
  | { status: 'adding' }
  | { status: 'added' }
  | { status: 'error'; message: string };

/**
 * "Recommendations" tab — a multi-signal ranker of candidates for this
 * job. Layout mirrors a classic ATS:
 *
 *   +-------------------+-------------------------------------+
 *   | Filters sidebar   | Search bar + ranked candidate list  |
 *   +-------------------+-------------------------------------+
 *
 * The score shown on each card is the `scorePct` computed by the API
 * from skill overlap (primary), location match, title similarity,
 * freshness and YoE fit. A tooltip exposes the per-signal breakdown
 * and the reasons the API returned, so recruiters understand *why*
 * a candidate ranks where they do (explainable > black-box).
 */
export default function JobRecommendationsPage() {
  const { job } = useJob();
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rowState, setRowState] = useState<Record<string, AddState>>({});

  // Filter state — kept in local state (no URL sync for now). Debounced
  // request below reloads whenever any filter changes.
  const [q, setQ] = useState('');
  const [location, setLocation] = useState('');
  const [minYoe, setMinYoe] = useState<string>('');
  const [maxYoe, setMaxYoe] = useState<string>('');
  const [skillIds, setSkillIds] = useState<string[]>([]);

  // Debounce text inputs so we don't spam the API on every keystroke.
  const [qDebounced, setQDebounced] = useState('');
  const [locDebounced, setLocDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const t = setTimeout(() => setLocDebounced(location.trim()), 250);
    return () => clearTimeout(t);
  }, [location]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '25');
    if (qDebounced) p.set('q', qDebounced);
    if (locDebounced) p.set('location', locDebounced);
    if (minYoe && /^\d+$/.test(minYoe)) p.set('minYoe', minYoe);
    if (maxYoe && /^\d+$/.test(maxYoe)) p.set('maxYoe', maxYoe);
    if (skillIds.length > 0) p.set('skillIds', skillIds.join(','));
    return p.toString();
  }, [qDebounced, locDebounced, minYoe, maxYoe, skillIds]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const res = await api<RecommendationsResponse>(
          `/jobs/${job.id}/recommendations?${queryString}`,
        );
        if (!cancelled) setData(res);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? 'Failed to load recommendations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [job.id, queryString]);

  async function addCandidate(cand: RecommendedCandidate) {
    setRowState((s) => ({ ...s, [cand.candidate.id]: { status: 'adding' } }));
    try {
      await api(`/applications`, {
        method: 'POST',
        body: { candidateId: cand.candidate.id, jobId: job.id },
      });
      setRowState((s) => ({ ...s, [cand.candidate.id]: { status: 'added' } }));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message ?? 'Failed to add';
      setRowState((s) => ({ ...s, [cand.candidate.id]: { status: 'error', message: msg } }));
    }
  }

  function toggleSkill(id: string) {
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  function resetFilters() {
    setQ('');
    setLocation('');
    setMinYoe('');
    setMaxYoe('');
    setSkillIds([]);
  }

  const hasActiveFilters =
    q || location || minYoe || maxYoe || skillIds.length > 0;
  const totalRequired = data?.requiredSkills.length ?? 0;

  return (
    <div className="p-6" data-testid="job-recommendations-page">
      <header className="mb-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Sparkles size={14} className="text-brand-600" /> Recommendations
        </h2>
        <p className="text-xs text-slate-500">
          Candidates ranked by a multi-signal match score: required skills, location, title
          similarity, freshness and years of experience.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
        {/* ---------------- Filters sidebar ----------------------------- */}
        <aside
          className="h-max rounded-lg border border-slate-200 bg-white p-3 text-xs"
          data-testid="recommendations-filters"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              <Filter size={12} /> Filters
            </h3>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-brand-700"
                data-testid="filters-reset"
              >
                <RefreshCw size={11} /> Reset
              </button>
            )}
          </div>

          <label className="mb-3 block">
            <span className="mb-1 block text-[11px] font-medium text-slate-600">Location</span>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. San Francisco"
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
              data-testid="filter-location"
            />
          </label>

          <fieldset className="mb-3">
            <legend className="mb-1 text-[11px] font-medium text-slate-600">
              Years of experience
            </legend>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={80}
                value={minYoe}
                onChange={(e) => setMinYoe(e.target.value)}
                placeholder="Min"
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                data-testid="filter-min-yoe"
              />
              <span className="text-slate-400">–</span>
              <input
                type="number"
                min={0}
                max={80}
                value={maxYoe}
                onChange={(e) => setMaxYoe(e.target.value)}
                placeholder="Max"
                className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                data-testid="filter-max-yoe"
              />
            </div>
          </fieldset>

          {(data?.requiredSkills.length ?? 0) > 0 && (
            <fieldset>
              <legend className="mb-1 text-[11px] font-medium text-slate-600">
                Required skills
              </legend>
              <p className="mb-1 text-[10px] text-slate-400">
                Tick to restrict to candidates holding those.
              </p>
              <ul className="space-y-1" data-testid="filter-skill-list">
                {data!.requiredSkills.map((s) => (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={skillIds.includes(s.id)}
                        onChange={() => toggleSkill(s.id)}
                        data-testid={`filter-skill-${s.id}`}
                      />
                      <span className="text-slate-700">{s.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
        </aside>

        {/* ---------------- Result list --------------------------------- */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, headline, title or company"
                className="w-full rounded-md border border-slate-300 py-1.5 pl-7 pr-3 text-sm focus:border-brand-500 focus:outline-none"
                data-testid="recommendations-search"
              />
            </div>
            <span
              className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600"
              data-testid="recommendations-count"
            >
              {data ? `${data.candidates.length} result${data.candidates.length === 1 ? '' : 's'}` : '…'}
            </span>
          </div>

          {err && (
            <p className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              {err}
            </p>
          )}

          {data && data.requiredSkills.length > 0 && (
            <RequiredSkillsHeader skills={data.requiredSkills} />
          )}

          {loading ? (
            <p className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
              Loading…
            </p>
          ) : !data || data.candidates.length === 0 ? (
            <EmptyState
              hasRequiredSkills={(data?.requiredSkills.length ?? 0) > 0}
              hasFilters={Boolean(hasActiveFilters)}
            />
          ) : (
            <ul className="space-y-2" data-testid="recommendations-list">
              {data.candidates.map((rec) => (
                <RecommendationRow
                  key={rec.candidate.id}
                  rec={rec}
                  totalRequired={totalRequired}
                  state={rowState[rec.candidate.id] ?? { status: 'idle' }}
                  onAdd={() => addCandidate(rec)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function RequiredSkillsHeader({ skills }: { skills: SkillRef[] }) {
  if (skills.length === 0) return null;
  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        Required skills
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {skills.map((s) => (
          <span
            key={s.id}
            className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200"
          >
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  hasRequiredSkills,
  hasFilters,
}: {
  hasRequiredSkills: boolean;
  hasFilters: boolean;
}) {
  return (
    <p
      className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400"
      data-testid="recommendations-empty"
    >
      {hasFilters
        ? 'No candidates match the current filters. Try loosening them or clearing the search.'
        : hasRequiredSkills
          ? 'No candidates in this account match the required skills yet. Try sourcing some profiles or adjusting the skills on the job.'
          : 'This job has no required skills set — add some on the job, or use the filter panel to search by location / title / years of experience.'}
    </p>
  );
}

function RecommendationRow({
  rec,
  totalRequired,
  state,
  onAdd,
}: {
  rec: RecommendedCandidate;
  totalRequired: number;
  state: AddState;
  onAdd: () => void;
}) {
  const { candidate, score, scorePct, matchedSkills, missingSkills, breakdown, reasons } = rec;
  return (
    <li
      className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
      data-testid="recommendation-row"
      data-candidate-id={candidate.id}
    >
      <div className="flex flex-col items-center gap-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
          {(candidate.firstName[0] ?? '?') + (candidate.lastName[0] ?? '')}
        </div>
        <ScoreBadge
          scorePct={scorePct}
          matched={score}
          totalRequired={totalRequired}
          breakdown={breakdown}
          reasons={reasons}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-slate-900">
            {candidate.firstName} {candidate.lastName}
          </p>
        </div>
        {candidate.headline && <p className="truncate text-xs text-slate-600">{candidate.headline}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {candidate.currentTitle && <span>{candidate.currentTitle}</span>}
          {candidate.currentCompany && (
            <span className="inline-flex items-center gap-1">
              <Briefcase size={11} /> {candidate.currentCompany}
            </span>
          )}
          {candidate.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={11} /> {candidate.location}
            </span>
          )}
          {typeof candidate.yearsExperience === 'number' && (
            <span>{candidate.yearsExperience}y exp</span>
          )}
        </div>
        {matchedSkills.length > 0 && <SkillPills label="Matches" tone="match" skills={matchedSkills} />}
        {missingSkills.length > 0 && <SkillPills label="Missing" tone="miss" skills={missingSkills} />}
      </div>
      <AddButton state={state} onClick={onAdd} />
    </li>
  );
}

/**
 * Circular score badge, inspired by the reference UI. We lean on an
 * inline SVG so it looks crisp at any size and stays accessible via the
 * surrounding title tooltip which lists the per-signal breakdown and
 * reasons.
 */
function ScoreBadge({
  scorePct,
  matched,
  totalRequired,
  breakdown,
  reasons,
}: {
  scorePct: number;
  matched: number;
  totalRequired: number;
  breakdown: RecommendedCandidate['breakdown'];
  reasons: string[];
}) {
  const color = scorePct >= 75 ? '#10b981' : scorePct >= 50 ? '#f59e0b' : '#94a3b8';
  const textColor =
    scorePct >= 75 ? 'text-emerald-700' : scorePct >= 50 ? 'text-amber-700' : 'text-slate-600';
  const tooltip = [
    ...reasons,
    `Skills ${breakdown.skillsPct}% · Location ${breakdown.locationPct}% · Title ${breakdown.titlePct}% · Fresh ${breakdown.freshnessPct}%${
      breakdown.yoePct !== null ? ` · YoE ${breakdown.yoePct}%` : ''
    }`,
  ].join(' — ');
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const dash = (scorePct / 100) * circumference;
  return (
    <div
      className="relative flex h-10 w-10 items-center justify-center"
      title={tooltip}
      data-testid="match-score"
      data-score-pct={scorePct}
    >
      <svg width={40} height={40} viewBox="0 0 40 40" aria-hidden>
        <circle cx={20} cy={20} r={radius} fill="transparent" stroke="#e2e8f0" strokeWidth={3} />
        <circle
          cx={20}
          cy={20}
          r={radius}
          fill="transparent"
          stroke={color}
          strokeWidth={3}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeDashoffset={0}
          transform="rotate(-90 20 20)"
          strokeLinecap="round"
        />
      </svg>
      <span className={`absolute text-[10px] font-semibold ${textColor}`}>{scorePct}%</span>
      <span className="sr-only">
        {totalRequired > 0
          ? `${matched} of ${totalRequired} required skills matched.`
          : 'Multi-signal match score.'}
      </span>
    </div>
  );
}

function SkillPills({
  label,
  tone,
  skills,
}: {
  label: string;
  tone: 'match' | 'miss';
  skills: SkillRef[];
}) {
  if (skills.length === 0) return null;
  const base =
    tone === 'match'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : 'bg-slate-50 text-slate-500 ring-slate-200';
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {label}:
      </span>
      {skills.map((s) => (
        <span
          key={s.id}
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${base}`}
        >
          {s.name}
        </span>
      ))}
    </div>
  );
}

function AddButton({ state, onClick }: { state: AddState; onClick: () => void }) {
  if (state.status === 'added') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
        data-testid="recommendation-added"
      >
        <Check size={12} /> Added
      </span>
    );
  }
  if (state.status === 'error') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-100"
        title={state.message}
      >
        Retry
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state.status === 'adding'}
      className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
      data-testid="recommendation-add"
    >
      <UserPlus size={12} /> {state.status === 'adding' ? 'Adding…' : 'Add to job'}
    </button>
  );
}
