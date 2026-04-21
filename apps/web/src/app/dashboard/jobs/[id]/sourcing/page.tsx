'use client';

import { FormEvent, useState } from 'react';
import { Briefcase, Check, Download, ExternalLink, Globe, MapPin, Search } from 'lucide-react';
import {
  api,
  ApiError,
  type CandidateImportResponse,
  type ExternalCandidate,
  type SourcingSearchResponse,
} from '@/lib/api';
import { useJob } from '../JobContext';

type RowState =
  | { status: 'idle' }
  | { status: 'importing' }
  | { status: 'imported'; deduped: boolean; candidateId: string }
  | { status: 'error'; message: string };

/**
 * "Sourcing" tab — search a third-party provider and import profiles into
 * this job.
 *
 * Design intent (matches the "External Sourcing Service" block in
 * `design/ATS-design.drawio.xml`):
 *   - recruiters keep the same Kanban workflow regardless of origin,
 *   - every import is persisted as a `CandidateImport` (audit + dedup),
 *   - re-importing the same externalId is a safe, explicit no-op.
 *
 * The backend currently ships with a single `linkedin-stub` provider for
 * development. Swapping in a real provider is a drop-in on the API side.
 */
export default function JobSourcingPage() {
  const { job } = useJob();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ExternalCandidate[] | null>(null);
  const [source, setSource] = useState<string>('linkedin-stub');
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [err, setErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    setErr(null);
    try {
      const res = await api<SourcingSearchResponse>(
        `/sourcing/search?q=${encodeURIComponent(query.trim())}`,
      );
      setResults(res.results);
      setSource(res.source);
      setRowState({});
    } catch (e: any) {
      setErr(e?.message ?? 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  async function importRow(ec: ExternalCandidate) {
    setRowState((s) => ({ ...s, [ec.externalId]: { status: 'importing' } }));
    try {
      const res = await api<CandidateImportResponse>(`/sourcing/import`, {
        method: 'POST',
        body: { source, externalId: ec.externalId, jobId: job.id },
      });
      setRowState((s) => ({
        ...s,
        [ec.externalId]: {
          status: 'imported',
          deduped: res.deduped,
          candidateId: res.candidate.id,
        },
      }));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message ?? 'Import failed';
      setRowState((s) => ({ ...s, [ec.externalId]: { status: 'error', message: msg } }));
    }
  }

  return (
    <div className="overflow-auto p-6" data-testid="job-sourcing-page">
      <div className="max-w-4xl space-y-4">
        <header>
          <h2 className="text-sm font-semibold text-slate-800">Sourcing</h2>
          <p className="text-xs text-slate-500">
            Find candidates from an external provider and import them into this job. Duplicate imports are safe — they
            resolve back to the original candidate.
          </p>
        </header>

        <form
          onSubmit={onSearch}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
          data-testid="sourcing-search-form"
        >
          <Search size={16} className="text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. 'react typescript berlin' or 'payments'…"
            className="flex-1 border-none text-sm focus:outline-none focus:ring-0"
            data-testid="sourcing-search-input"
          />
          <button
            type="submit"
            disabled={!query.trim() || searching}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
            data-testid="sourcing-search-submit"
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {err && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            {err}
          </p>
        )}

        {results === null ? (
          <p className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
            Run a search to find external candidates. (Dev provider: <code>linkedin-stub</code>.)
          </p>
        ) : results.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
            No results. Try a different keyword.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="sourcing-results">
            {results.map((r) => (
              <ExternalCandidateRow
                key={r.externalId}
                candidate={r}
                state={rowState[r.externalId] ?? { status: 'idle' }}
                onImport={() => importRow(r)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ExternalCandidateRow({
  candidate,
  state,
  onImport,
}: {
  candidate: ExternalCandidate;
  state: RowState;
  onImport: () => void;
}) {
  return (
    <li
      className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
      data-testid="sourcing-result"
      data-external-id={candidate.externalId}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
        {(candidate.firstName[0] ?? '?') + (candidate.lastName[0] ?? '')}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900" data-testid="sourcing-result-name">
          {candidate.firstName} {candidate.lastName}
          {candidate.profileUrl && (
            <a
              href={candidate.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1.5 inline-flex text-slate-400 hover:text-brand-600"
              aria-label="Open profile"
            >
              <ExternalLink size={12} />
            </a>
          )}
        </p>
        {candidate.headline && (
          <p className="truncate text-xs text-slate-600">{candidate.headline}</p>
        )}
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
            <span className="inline-flex items-center gap-1">
              <Globe size={11} /> {candidate.yearsExperience}y exp
            </span>
          )}
        </div>
        {candidate.skills && candidate.skills.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {candidate.skills.slice(0, 6).map((s) => (
              <span
                key={s}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
              >
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
      <ImportButton state={state} onClick={onImport} />
    </li>
  );
}

function ImportButton({ state, onClick }: { state: RowState; onClick: () => void }) {
  if (state.status === 'imported') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200"
        data-testid="sourcing-result-imported"
      >
        <Check size={12} /> {state.deduped ? 'Already on job' : 'Imported'}
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
      disabled={state.status === 'importing'}
      className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
      data-testid="sourcing-result-import"
    >
      <Download size={12} /> {state.status === 'importing' ? 'Importing…' : 'Import to job'}
    </button>
  );
}
