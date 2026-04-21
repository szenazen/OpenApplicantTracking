'use client';

import { useEffect, useMemo, useState } from 'react';
import { Briefcase, MapPin, Search } from 'lucide-react';
import { api, CandidateListItem } from '@/lib/api';
import { avatarColor, formatYearsExperience, getInitials } from '@/lib/format';
import { useAuth } from '@/lib/store';

/**
 * Dedicated Candidates view — complements the Kanban-per-job page by giving
 * recruiters a flat, scannable list of everyone in the active account's
 * regional database.
 *
 * Each row surfaces the facts that drive follow-up decisions:
 *   - name, headline, current title/company, location, years-of-experience
 *   - a compact skills chip list (CANDIDATE_SKILLS junction)
 *   - total vs. active application counts (active excludes HIRED/DROPPED)
 *
 * Filtering is client-side on top of the server's search param so the
 * current 200-row cap gives a snappy experience without extra requests.
 */
export default function CandidatesPage() {
  const { activeAccountId } = useAuth();
  const [rows, setRows] = useState<CandidateListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!activeAccountId) return;
    setRows(null);
    setError(null);
    api<CandidateListItem[]>('/candidates')
      .then((r) => setRows(r))
      .catch((e) => setError(e.message ?? 'Failed to load candidates'));
  }, [activeAccountId]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((c) => {
      const haystack = [
        c.firstName,
        c.lastName,
        c.email,
        c.currentCompany,
        c.currentTitle,
        c.headline,
        c.location,
        ...c.skills.map((s) => s.name),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [rows, q]);

  return (
    <div className="p-6" data-testid="candidates-page">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Candidates</h1>
          <p className="text-xs text-slate-500">
            All candidates in this account&apos;s region — active counts exclude hired &amp; dropped.
          </p>
        </div>
        <label className="relative w-64">
          <Search size={14} className="absolute left-2 top-2 text-slate-400" />
          <input
            type="search"
            aria-label="Filter candidates"
            placeholder="Filter by name, email, skill…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="candidates-filter"
            className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-7 pr-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!rows && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {filtered && filtered.length === 0 && !error && (
        <p className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          {q ? 'No candidates match your filter.' : 'No candidates yet for this account.'}
        </p>
      )}

      {filtered && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Candidate</th>
                <th className="px-3 py-2">Current role</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Skills</th>
                <th className="px-3 py-2 text-right">Applications</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100" data-testid="candidates-table-body">
              {filtered.map((c) => (
                <CandidateRow key={c.id} c={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CandidateRow({ c }: { c: CandidateListItem }) {
  const initials = getInitials(c.firstName, c.lastName);
  const palette = avatarColor(c.id);
  const yoe = formatYearsExperience(c.yearsExperience);
  return (
    <tr data-testid="candidate-row" className="hover:bg-slate-50">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${palette.bg} ${palette.fg}`}
            aria-hidden
          >
            {initials}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-slate-900" data-testid="candidate-name">
              {c.firstName} {c.lastName}
            </div>
            {c.email && <div className="truncate text-xs text-slate-500">{c.email}</div>}
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-col text-xs text-slate-700">
          {(c.currentTitle || c.currentCompany) && (
            <span className="inline-flex items-center gap-1">
              <Briefcase size={12} className="text-slate-400" />
              <span className="truncate">
                {c.currentTitle ?? '—'}
                {c.currentCompany ? ` @ ${c.currentCompany}` : ''}
              </span>
            </span>
          )}
          {yoe && <span className="text-slate-500">{yoe} experience</span>}
        </div>
      </td>
      <td className="px-3 py-2 align-top text-xs text-slate-700">
        {c.location ? (
          <span className="inline-flex items-center gap-1">
            <MapPin size={12} className="text-slate-400" /> {c.location}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        {c.skills.length === 0 ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {c.skills.slice(0, 4).map((s) => (
              <li
                key={s.skillId}
                className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700"
                title={s.level ? `Proficiency: ${s.level}/5` : undefined}
              >
                {s.name}
              </li>
            ))}
            {c.skills.length > 4 && (
              <li className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                +{c.skills.length - 4}
              </li>
            )}
          </ul>
        )}
      </td>
      <td className="px-3 py-2 text-right align-top">
        <div className="inline-flex items-baseline gap-1">
          <span
            className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700"
            title="Active applications (not hired / dropped)"
            data-testid="candidate-active-count"
          >
            {c.applicationCounts.active}
          </span>
          <span className="text-xs text-slate-400">/ {c.applicationCounts.total}</span>
        </div>
      </td>
    </tr>
  );
}
