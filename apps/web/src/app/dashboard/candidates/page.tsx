'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Briefcase, ChevronDown, Filter, MapPin, Search, X } from 'lucide-react';
import {
  api,
  CandidateListItem,
  CandidateListQuery,
  CandidateListResponse,
  SkillRef,
} from '@/lib/api';
import { avatarColor, formatYearsExperience, getInitials } from '@/lib/format';
import { useAuth } from '@/lib/store';
import { CandidateDrawer } from '@/components/CandidateDrawer';

/**
 * Dedicated Candidates view — complements the Kanban-per-job page by giving
 * recruiters a flat, scannable list of everyone in the active account's
 * regional database, with server-side pagination and filters so the list
 * scales past the previous 200-row client cap.
 *
 * Filters persisted to the URL (so a shared link reproduces the view):
 *   - q          : substring search
 *   - skillIds   : comma-separated (AND semantics — candidate must have ALL)
 *   - hasActive  : "true" / "false"
 *   - minYoe / maxYoe : inclusive bounds on yearsExperience (non-null only)
 *   - application : opens the drawer for that application (full card)
 *   - candidate   : profile preview for a candidate id (no application yet)
 *
 * Pagination is keyset via an opaque `nextCursor`, with a single "Load more"
 * button — a scrollable table doesn't need infinite scroll and the manual
 * button keeps keyboard navigation predictable.
 */
export default function CandidatesPage() {
  const { activeAccountId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ------------------- URL-backed filter state -------------------
  const urlQ = searchParams.get('q') ?? '';
  const urlSkillIds = (searchParams.get('skillIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const urlHasActive = parseHasActive(searchParams.get('hasActive'));
  const urlMinYoe = parseNonNegInt(searchParams.get('minYoe'));
  const urlMaxYoe = parseNonNegInt(searchParams.get('maxYoe'));
  const urlAppId = searchParams.get('application');
  const urlCandidateId = searchParams.get('candidate');

  // The URL is the source of truth for applied filters. `q` has its own
  // debounced local state so typing feels instant without a 200ms flash
  // of stale rows.
  const [qDraft, setQDraft] = useState(urlQ);
  useEffect(() => setQDraft(urlQ), [urlQ]);

  // Debounced commit of qDraft → URL. 250ms balances "snappy while typing"
  // against "don't spam the API on every keystroke".
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (qDraft === urlQ) return;
    debounceRef.current = setTimeout(() => {
      updateUrl({ q: qDraft });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // updateUrl is stable (useCallback) and qDraft/urlQ are the only inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft, urlQ]);

  const updateUrl = useCallback(
    (patch: Partial<{
      q: string;
      skillIds: string[];
      hasActive: boolean | undefined;
      minYoe: number | undefined;
      maxYoe: number | undefined;
      application: string | null;
      candidate: string | null;
    }>) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'skillIds') {
          const ids = (value as string[]) ?? [];
          if (ids.length) params.set('skillIds', ids.join(','));
          else params.delete('skillIds');
        } else if (key === 'hasActive') {
          if (value === true) params.set('hasActive', 'true');
          else if (value === false) params.set('hasActive', 'false');
          else params.delete('hasActive');
        } else if (key === 'minYoe' || key === 'maxYoe') {
          if (typeof value === 'number' && Number.isFinite(value)) params.set(key, String(value));
          else params.delete(key);
        } else if (key === 'application') {
          if (value) {
            params.set('application', value as string);
            params.delete('candidate');
          } else params.delete('application');
        } else if (key === 'candidate') {
          if (value) {
            params.set('candidate', value as string);
            params.delete('application');
          } else params.delete('candidate');
        } else if (key === 'q') {
          const v = value as string;
          if (v && v.trim()) params.set('q', v);
          else params.delete('q');
        }
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // ------------------- Skills catalog for the filter picker -------------------
  // Load once per session; the picker is a lightweight inline menu, not a
  // typeahead — the catalog is small (< 200 rows in practice).
  const [skills, setSkills] = useState<SkillRef[] | null>(null);
  useEffect(() => {
    if (skills !== null) return;
    api<SkillRef[]>('/skills')
      .then((rows) => setSkills(rows.map(({ id, name }) => ({ id, name }))))
      .catch(() => setSkills([]));
  }, [skills]);

  const selectedSkills = useMemo(
    () => (skills ?? []).filter((s) => urlSkillIds.includes(s.id)),
    [skills, urlSkillIds],
  );

  // ------------------- Data loading (paginated) -------------------
  const [items, setItems] = useState<CandidateListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        q: urlQ,
        skillIds: urlSkillIds.slice().sort(),
        hasActive: urlHasActive,
        minYoe: urlMinYoe,
        maxYoe: urlMaxYoe,
        account: activeAccountId,
      }),
    [activeAccountId, urlHasActive, urlMaxYoe, urlMinYoe, urlQ, urlSkillIds],
  );

  useEffect(() => {
    if (!activeAccountId) return;
    const query: CandidateListQuery = {
      q: urlQ || undefined,
      skillIds: urlSkillIds.length ? urlSkillIds : undefined,
      hasActive: urlHasActive,
      minYoe: urlMinYoe,
      maxYoe: urlMaxYoe,
      limit: 50,
    };
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<CandidateListResponse>(`/candidates${buildQueryString(query)}`)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setNextCursor(res.nextCursor);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load candidates');
        setItems([]);
        setNextCursor(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `filterKey` rolls up everything the query cares about so the effect
    // fires exactly once per filter change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const query: CandidateListQuery = {
      q: urlQ || undefined,
      skillIds: urlSkillIds.length ? urlSkillIds : undefined,
      hasActive: urlHasActive,
      minYoe: urlMinYoe,
      maxYoe: urlMaxYoe,
      limit: 50,
      cursor: nextCursor,
    };
    setLoadingMore(true);
    api<CandidateListResponse>(`/candidates${buildQueryString(query)}`)
      .then((res) => {
        setItems((cur) => [...cur, ...res.items]);
        setNextCursor(res.nextCursor);
      })
      .catch((e) => setError(e.message ?? 'Failed to load more candidates'))
      .finally(() => setLoadingMore(false));
  }, [nextCursor, loadingMore, urlQ, urlSkillIds, urlHasActive, urlMinYoe, urlMaxYoe]);

  // ------------------- Drawer -------------------
  const openApplicationDrawer = useCallback(
    (applicationId: string) => updateUrl({ application: applicationId, candidate: null }),
    [updateUrl],
  );
  const openCandidatePreview = useCallback(
    (candidateId: string) => updateUrl({ application: null, candidate: candidateId }),
    [updateUrl],
  );
  const closeDrawer = useCallback(
    () => updateUrl({ application: null, candidate: null }),
    [updateUrl],
  );

  const hasAnyFilter =
    urlQ.length > 0 ||
    urlSkillIds.length > 0 ||
    urlHasActive !== undefined ||
    urlMinYoe !== undefined ||
    urlMaxYoe !== undefined;

  const clearAllFilters = useCallback(() => {
    updateUrl({
      q: '',
      skillIds: [],
      hasActive: undefined,
      minYoe: undefined,
      maxYoe: undefined,
      application: null,
      candidate: null,
    });
    setQDraft('');
  }, [updateUrl]);

  return (
    <div className="p-6" data-testid="candidates-page">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
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
            placeholder="Name, email, title, company…"
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            data-testid="candidates-filter"
            className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-7 pr-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </label>
      </div>

      <FilterPanel
        skills={skills}
        selectedSkills={selectedSkills}
        selectedSkillIds={urlSkillIds}
        hasActive={urlHasActive}
        minYoe={urlMinYoe}
        maxYoe={urlMaxYoe}
        hasAnyFilter={hasAnyFilter}
        onChange={updateUrl}
        onClearAll={clearAllFilters}
      />

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700" data-testid="candidates-error">
          {error}
        </p>
      )}
      {loading && items.length === 0 && !error && (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      )}
      {!loading && items.length === 0 && !error && (
        <p className="mt-3 rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500" data-testid="candidates-empty">
          {hasAnyFilter ? 'No candidates match your filters.' : 'No candidates yet for this account.'}
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
              {items.map((c) => (
                <CandidateRow
                  key={c.id}
                  c={c}
                  onOpenApplication={openApplicationDrawer}
                  onOpenCandidatePreview={openCandidatePreview}
                />
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <span data-testid="candidates-count">{items.length} loaded</span>
            {nextCursor ? (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="candidates-load-more"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            ) : (
              <span className="text-slate-400" data-testid="candidates-end">End of list</span>
            )}
          </div>
        </div>
      )}

      {urlAppId && (
        <CandidateDrawer applicationId={urlAppId} onClose={closeDrawer} />
      )}
      {!urlAppId && urlCandidateId && (
        <CandidateDrawer
          applicationId={null}
          previewCandidateId={urlCandidateId}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}

/**
 * Side-by-side filter controls for skills / active / yoe. Each control
 * writes through to the URL via `onChange` so a shared URL reproduces the
 * exact same filtered view.
 */
function FilterPanel({
  skills,
  selectedSkills,
  selectedSkillIds,
  hasActive,
  minYoe,
  maxYoe,
  hasAnyFilter,
  onChange,
  onClearAll,
}: {
  skills: SkillRef[] | null;
  selectedSkills: SkillRef[];
  selectedSkillIds: string[];
  hasActive: boolean | undefined;
  minYoe: number | undefined;
  maxYoe: number | undefined;
  hasAnyFilter: boolean;
  onChange: (patch: Partial<{
    q: string;
    skillIds: string[];
    hasActive: boolean | undefined;
    minYoe: number | undefined;
    maxYoe: number | undefined;
    application: string | null;
  }>) => void;
  onClearAll: () => void;
}) {
  const toggleSkill = useCallback(
    (id: string) => {
      const next = selectedSkillIds.includes(id)
        ? selectedSkillIds.filter((s) => s !== id)
        : [...selectedSkillIds, id];
      onChange({ skillIds: next });
    },
    [onChange, selectedSkillIds],
  );

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2"
      data-testid="candidates-filter-panel"
    >
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <Filter size={12} /> Filters
      </span>

      <SkillPicker
        skills={skills}
        selectedSkills={selectedSkills}
        onToggle={toggleSkill}
        onClear={() => onChange({ skillIds: [] })}
      />

      <ActiveFilter value={hasActive} onChange={(v) => onChange({ hasActive: v })} />

      <YoeFilter
        min={minYoe}
        max={maxYoe}
        onChange={(next) => onChange({ minYoe: next.min, maxYoe: next.max })}
      />

      {hasAnyFilter && (
        <button
          type="button"
          className="ml-auto text-xs font-medium text-brand-600 hover:underline"
          onClick={onClearAll}
          data-testid="candidates-filters-clear"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

/**
 * Multi-select skill picker with a check-list popover. AND semantics are
 * enforced server-side — we just collect ids and let the server decide.
 */
function SkillPicker({
  skills,
  selectedSkills,
  onToggle,
  onClear,
}: {
  skills: SkillRef[] | null;
  selectedSkills: SkillRef[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const popRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = skills ?? [];
    if (!needle) return rows.slice(0, 40);
    return rows.filter((s) => s.name.toLowerCase().includes(needle)).slice(0, 40);
  }, [query, skills]);

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        data-testid="candidates-skill-picker"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        Skills
        {selectedSkills.length > 0 && (
          <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
            {selectedSkills.length}
          </span>
        )}
        <ChevronDown size={12} className="text-slate-400" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border border-slate-200 bg-white p-2 shadow-lg"
          data-testid="candidates-skill-menu"
        >
          <div className="mb-2 flex items-center justify-between">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills…"
              className="w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none"
              aria-label="Search skills"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {skills === null && <li className="px-2 py-1 text-xs text-slate-400">Loading…</li>}
            {skills !== null && filtered.length === 0 && (
              <li className="px-2 py-1 text-xs text-slate-400">No skills match.</li>
            )}
            {filtered.map((s) => {
              const checked = selectedSkills.some((ss) => ss.id === s.id);
              return (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(s.id)}
                      data-testid={`skill-option-${s.id}`}
                    />
                    <span>{s.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {selectedSkills.length > 0 && (
            <div className="mt-2 border-t border-slate-200 pt-2 text-right">
              <button
                type="button"
                className="text-[11px] font-medium text-slate-500 hover:text-brand-600"
                onClick={onClear}
              >
                Clear selected
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActiveFilter({
  value,
  onChange,
}: {
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
}) {
  // Tri-state: "Any" (undefined) / "Active" (true) / "No applications" (false).
  // Rendered as a compact segmented control — a select would hide the
  // current state behind a click and a boolean checkbox can't distinguish
  // "no filter" from "negative filter".
  return (
    <div
      className="inline-flex items-center overflow-hidden rounded-md border border-slate-300 bg-white text-xs"
      role="group"
      aria-label="Application status filter"
      data-testid="candidates-active-filter"
    >
      <SegButton active={value === undefined} onClick={() => onChange(undefined)}>
        Any
      </SegButton>
      <SegButton active={value === true} onClick={() => onChange(true)} testId="active-true">
        Active
      </SegButton>
      <SegButton active={value === false} onClick={() => onChange(false)} testId="active-false">
        No apps
      </SegButton>
    </div>
  );
}

function SegButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={
        'px-2 py-1 font-medium transition ' +
        (active
          ? 'bg-brand-600 text-white'
          : 'text-slate-600 hover:bg-slate-50')
      }
    >
      {children}
    </button>
  );
}

function YoeFilter({
  min,
  max,
  onChange,
}: {
  min: number | undefined;
  max: number | undefined;
  onChange: (v: { min: number | undefined; max: number | undefined }) => void;
}) {
  const [minDraft, setMinDraft] = useState(min?.toString() ?? '');
  const [maxDraft, setMaxDraft] = useState(max?.toString() ?? '');
  useEffect(() => setMinDraft(min?.toString() ?? ''), [min]);
  useEffect(() => setMaxDraft(max?.toString() ?? ''), [max]);

  const commit = useCallback(() => {
    const nextMin = parseYoeInput(minDraft);
    const nextMax = parseYoeInput(maxDraft);
    if (nextMin === min && nextMax === max) return;
    onChange({ min: nextMin, max: nextMax });
  }, [maxDraft, minDraft, onChange, min, max]);

  return (
    <div
      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
      data-testid="candidates-yoe-filter"
    >
      <span className="font-medium text-slate-500">YoE</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={60}
        placeholder="min"
        value={minDraft}
        onChange={(e) => setMinDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="w-12 rounded border border-slate-200 px-1 py-0.5 text-xs focus:border-brand-500 focus:outline-none"
        aria-label="Minimum years of experience"
        data-testid="candidates-yoe-min"
      />
      <span className="text-slate-400">–</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={60}
        placeholder="max"
        value={maxDraft}
        onChange={(e) => setMaxDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className="w-12 rounded border border-slate-200 px-1 py-0.5 text-xs focus:border-brand-500 focus:outline-none"
        aria-label="Maximum years of experience"
        data-testid="candidates-yoe-max"
      />
      {(min !== undefined || max !== undefined) && (
        <button
          type="button"
          onClick={() => onChange({ min: undefined, max: undefined })}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Clear YoE filter"
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

function CandidateRow({
  c,
  onOpenApplication,
  onOpenCandidatePreview,
}: {
  c: CandidateListItem;
  onOpenApplication: (applicationId: string) => void;
  onOpenCandidatePreview: (candidateId: string) => void;
}) {
  const initials = getInitials(c.firstName, c.lastName);
  const palette = avatarColor(c.id);
  const yoe = formatYearsExperience(c.yearsExperience);
  const open = () => {
    if (c.mostRecentApplicationId) onOpenApplication(c.mostRecentApplicationId);
    else onOpenCandidatePreview(c.id);
  };
  return (
    <tr
      data-testid="candidate-row"
      data-candidate-id={c.id}
      data-most-recent-app-id={c.mostRecentApplicationId ?? ''}
      data-skill-names={JSON.stringify(c.skills.map((s) => s.name))}
      className="cursor-pointer transition hover:bg-slate-50 focus-within:bg-slate-50"
      onClick={open}
      tabIndex={0}
      role="button"
      aria-label={`Open details for ${c.firstName} ${c.lastName}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
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
          {c.applicationCounts.total === 0 && (
            <span
              className="ml-2 text-[10px] text-slate-400"
              title="No applications yet — profile opens in preview; add from a job board"
            >
              no apps
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

// -------------------- helpers --------------------

/**
 * Build a `?` query string from a CandidateListQuery. We do NOT use
 * URLSearchParams for arrays because our backend expects a single
 * comma-separated `skillIds` value.
 */
function buildQueryString(q: CandidateListQuery): string {
  const parts: string[] = [];
  if (q.q) parts.push(`q=${encodeURIComponent(q.q)}`);
  if (q.skillIds && q.skillIds.length) {
    parts.push(`skillIds=${encodeURIComponent(q.skillIds.join(','))}`);
  }
  if (q.hasActive === true) parts.push('hasActive=true');
  if (q.hasActive === false) parts.push('hasActive=false');
  if (typeof q.minYoe === 'number') parts.push(`minYoe=${q.minYoe}`);
  if (typeof q.maxYoe === 'number') parts.push(`maxYoe=${q.maxYoe}`);
  if (typeof q.limit === 'number') parts.push(`limit=${q.limit}`);
  if (q.cursor) parts.push(`cursor=${encodeURIComponent(q.cursor)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function parseHasActive(raw: string | null): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function parseNonNegInt(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return undefined;
  return n;
}

function parseYoeInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}
