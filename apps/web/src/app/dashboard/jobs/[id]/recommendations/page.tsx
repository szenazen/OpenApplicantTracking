'use client';

import { useEffect, useState } from 'react';
import { Briefcase, Check, MapPin, Sparkles, UserPlus } from 'lucide-react';
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
 * "Recommendations" tab — ranked candidates for this job based on skill
 * overlap with `job.requiredSkillIds`.
 *
 * We surface the explainable score (matched / missing skills, plus a small
 * match meter) instead of a single opaque "compatibility %". That keeps the
 * recruiter in the loop and makes tuning the algorithm later easy to
 * compare against the current baseline.
 */
export default function JobRecommendationsPage() {
  const { job } = useJob();
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rowState, setRowState] = useState<Record<string, AddState>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const res = await api<RecommendationsResponse>(
          `/jobs/${job.id}/recommendations?limit=25`,
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
  }, [job.id]);

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

  return (
    <div className="overflow-auto p-6" data-testid="job-recommendations-page">
      <div className="max-w-4xl space-y-4">
        <header>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Sparkles size={14} className="text-brand-600" /> Recommendations
          </h2>
          <p className="text-xs text-slate-500">
            Candidates in your account ranked by how many of this job&apos;s required skills they already hold. Adding
            one creates an application on the first pipeline stage.
          </p>
        </header>

        {err && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            {err}
          </p>
        )}

        {!err && data && <RequiredSkillsHeader skills={data.requiredSkills} />}

        {loading ? (
          <p className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
            Loading…
          </p>
        ) : !data || data.candidates.length === 0 ? (
          <EmptyState hasRequiredSkills={(data?.requiredSkills.length ?? 0) > 0} />
        ) : (
          <ul className="space-y-2" data-testid="recommendations-list">
            {data.candidates.map((rec) => (
              <RecommendationRow
                key={rec.candidate.id}
                rec={rec}
                totalRequired={data.requiredSkills.length}
                state={rowState[rec.candidate.id] ?? { status: 'idle' }}
                onAdd={() => addCandidate(rec)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RequiredSkillsHeader({ skills }: { skills: SkillRef[] }) {
  if (skills.length === 0) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Required skills</p>
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

function EmptyState({ hasRequiredSkills }: { hasRequiredSkills: boolean }) {
  return (
    <p
      className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400"
      data-testid="recommendations-empty"
    >
      {hasRequiredSkills
        ? 'No candidates in this account match the required skills yet. Try sourcing some profiles or adjusting the skills on the job.'
        : 'This job has no required skills set — add some to get ranked recommendations.'}
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
  const { candidate, score, matchedSkills, missingSkills } = rec;
  const pct = totalRequired > 0 ? Math.round((score / totalRequired) * 100) : 0;
  return (
    <li
      className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
      data-testid="recommendation-row"
      data-candidate-id={candidate.id}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
        {(candidate.firstName[0] ?? '?') + (candidate.lastName[0] ?? '')}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-slate-900">
            {candidate.firstName} {candidate.lastName}
          </p>
          <MatchMeter score={score} total={totalRequired} pct={pct} />
        </div>
        {candidate.headline && <p className="truncate text-xs text-slate-600">{candidate.headline}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
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
        <SkillPills label="Matches" tone="match" skills={matchedSkills} />
        {missingSkills.length > 0 && <SkillPills label="Missing" tone="miss" skills={missingSkills} />}
      </div>
      <AddButton state={state} onClick={onAdd} />
    </li>
  );
}

function MatchMeter({ score, total, pct }: { score: number; total: number; pct: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
      title={`${score} of ${total} required skills matched`}
      data-testid="match-meter"
    >
      {score}/{total} · {pct}%
    </span>
  );
}

function SkillPills({ label, tone, skills }: { label: string; tone: 'match' | 'miss'; skills: SkillRef[] }) {
  if (skills.length === 0) return null;
  const base =
    tone === 'match'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : 'bg-slate-50 text-slate-500 ring-slate-200';
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}:</span>
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
