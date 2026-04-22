'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Building2, Filter, MapPin, Plus, Search, Users } from 'lucide-react';
import {
  api,
  JobListItem,
  JobListQuery,
  JobListResponse,
  JobStatus,
} from '@/lib/api';
import { avatarColor, formatRelativeDuration, getInitials } from '@/lib/format';
import { useAuth } from '@/lib/store';
import { JobCreateDialog } from '@/components/JobCreateDialog';

/**
 * Dedicated Jobs table view — the data-dense counterpart to the recruiter
 * home page. Sits at `/dashboard/jobs` so the main nav can separate "what's
 * happening right now" (home) from "find a specific req" (jobs).
 *
 * Columns mirror the design reference:
 *   Name · Client · Location · # of Candidates · Head Count · Status · Date
 *
 * Filters are URL-backed so a deep link reproduces the exact view:
 *   - q       : substring search (title / department / location / client)
 *   - status  : single status filter
 *   - includeArchived : "true" to show archived reqs alongside the active ones
 *
 * Pagination is keyset via an opaque `nextCursor`, surfaced through a single
 * "Load more" button — consistent with the candidates list.
 */
const STATUS_OPTIONS: Array<JobStatus> = ['DRAFT', 'PUBLISHED', 'ON_HOLD', 'CLOSED', 'ARCHIVED'];

export default function JobsTablePage() {
  const { activeAccountId } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ------------------- URL-backed filter state -------------------
  const urlQ = searchParams.get('q') ?? '';
  const urlStatus = parseStatus(searchParams.get('status'));
  const urlIncludeArchived = searchParams.get('includeArchived') === 'true';

  const [qDraft, setQDraft] = useState(urlQ);
  useEffect(() => setQDraft(urlQ), [urlQ]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft, urlQ]);

  const updateUrl = useCallback(
    (patch: Partial<{ q: string; status: JobStatus | undefined; includeArchived: boolean }>) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'q') {
          const v = value as string;
          if (v && v.trim()) params.set('q', v);
          else params.delete('q');
        } else if (key === 'status') {
          if (value) params.set('status', value as string);
          else params.delete('status');
        } else if (key === 'includeArchived') {
          if (value === true) params.set('includeArchived', 'true');
          else params.delete('includeArchived');
        }
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // ------------------- Data loading (paginated) -------------------
  const [items, setItems] = useState<JobListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // `filterKey` rolls up every query-affecting input so the effect fires
  // exactly once per filter change (not on every render).
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        q: urlQ,
        status: urlStatus,
        includeArchived: urlIncludeArchived,
        account: activeAccountId,
      }),
    [activeAccountId, urlIncludeArchived, urlQ, urlStatus],
  );

  useEffect(() => {
    if (!activeAccountId) return;
    const query: JobListQuery = {
      q: urlQ || undefined,
      status: urlStatus,
      includeArchived: urlIncludeArchived || undefined,
      limit: 50,
    };
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<JobListResponse>(`/jobs${buildJobQueryString(query)}`)
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setNextCursor(res.nextCursor);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load jobs');
        setItems([]);
        setNextCursor(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const query: JobListQuery = {
      q: urlQ || undefined,
      status: urlStatus,
      includeArchived: urlIncludeArchived || undefined,
      limit: 50,
      cursor: nextCursor,
    };
    setLoadingMore(true);
    api<JobListResponse>(`/jobs${buildJobQueryString(query)}`)
      .then((res) => {
        setItems((cur) => [...cur, ...res.items]);
        setNextCursor(res.nextCursor);
      })
      .catch((e) => setError(e.message ?? 'Failed to load more jobs'))
      .finally(() => setLoadingMore(false));
  }, [nextCursor, loadingMore, urlQ, urlStatus, urlIncludeArchived]);

  const hasAnyFilter = urlQ.length > 0 || !!urlStatus || urlIncludeArchived;

  const clearAllFilters = useCallback(() => {
    updateUrl({ q: '', status: undefined, includeArchived: false });
    setQDraft('');
  }, [updateUrl]);

  return (
    <div className="p-6" data-testid="jobs-page">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-xs text-slate-500">
            Every open &amp; recent requisition in this account&apos;s region.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative w-64">
            <Search size={14} className="absolute left-2 top-2 text-slate-400" />
            <input
              type="search"
              aria-label="Filter jobs"
              placeholder="Title, client, location, department…"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              data-testid="jobs-filter"
              className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-7 pr-2 text-sm focus:border-brand-500 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
            data-testid="jobs-create"
          >
            <Plus size={14} /> New job
          </button>
        </div>
      </div>

      <div
        className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2"
        data-testid="jobs-filter-panel"
      >
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Filter size={12} /> Filters
        </span>
        <StatusFilter value={urlStatus} onChange={(v) => updateUrl({ status: v })} />
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={urlIncludeArchived}
            onChange={(e) => updateUrl({ includeArchived: e.target.checked })}
            data-testid="jobs-include-archived"
          />
          Include archived
        </label>
        {hasAnyFilter && (
          <button
            type="button"
            className="ml-auto text-xs font-medium text-brand-600 hover:underline"
            onClick={clearAllFilters}
            data-testid="jobs-filters-clear"
          >
            Clear all
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700" data-testid="jobs-error">
          {error}
        </p>
      )}
      {loading && items.length === 0 && !error && <p className="mt-3 text-sm text-slate-500">Loading…</p>}
      {!loading && items.length === 0 && !error && (
        <p
          className="mt-3 rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500"
          data-testid="jobs-empty"
        >
          {hasAnyFilter ? 'No jobs match your filters.' : 'No jobs yet for this account.'}
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2 text-right"># of Candidates</th>
                <th className="px-3 py-2 text-right">Head Count</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Date of submission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100" data-testid="jobs-table-body">
              {items.map((j) => (
                <JobRow key={j.id} j={j} />
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <span data-testid="jobs-count">{items.length} loaded</span>
            {nextCursor ? (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="jobs-load-more"
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            ) : (
              <span className="text-slate-400" data-testid="jobs-end">
                End of list
              </span>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <JobCreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={(job) => {
            setShowCreate(false);
            router.push(`/dashboard/jobs/${job.id}`);
          }}
        />
      )}
    </div>
  );
}

/**
 * Compact status dropdown. We keep it as a plain `<select>` — a fancy
 * popover doesn't pay for itself on a 5-option enum, and the native
 * element is accessible and keyboard-friendly out of the box.
 */
function StatusFilter({
  value,
  onChange,
}: {
  value: JobStatus | undefined;
  onChange: (v: JobStatus | undefined) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700">
      <span className="font-medium text-slate-500">Status</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? (e.target.value as JobStatus) : undefined)}
        className="bg-transparent text-xs focus:outline-none"
        data-testid="jobs-status-filter"
      >
        <option value="">Any</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {prettyStatus(s)}
          </option>
        ))}
      </select>
    </label>
  );
}

function JobRow({ j }: { j: JobListItem }) {
  const palette = avatarColor(j.id);
  const initials = j.clientName
    ? getInitials(j.clientName)
    : getInitials(j.title);
  return (
    <tr
      className="cursor-default transition hover:bg-slate-50"
      data-testid="jobs-row"
      data-job-id={j.id}
    >
      <td className="px-3 py-2">
        <Link
          href={`/dashboard/jobs/${j.id}`}
          className="font-medium text-brand-700 hover:underline"
          data-testid="jobs-title"
        >
          {j.title}
        </Link>
        {j.department && (
          <div className="text-[11px] text-slate-500">{j.department}</div>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold ${palette.bg} ${palette.fg}`}
            aria-hidden
          >
            {initials}
          </span>
          <span className="text-xs text-slate-700">
            {j.clientName ?? <span className="text-slate-400">—</span>}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 align-top text-xs text-slate-700">
        {j.location ? (
          <span className="inline-flex items-center gap-1">
            <MapPin size={12} className="text-slate-400" /> {j.location}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-right align-top">
        <div className="inline-flex items-baseline gap-1" data-testid="jobs-candidates">
          <span
            className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700"
            title="Active candidates (not hired / dropped)"
          >
            {j.candidateCounts.active}
          </span>
          <span className="text-xs text-slate-400">/ {j.candidateCounts.total}</span>
        </div>
      </td>
      <td className="px-3 py-2 text-right align-top text-xs text-slate-700">
        <span className="inline-flex items-center gap-1" data-testid="jobs-headcount">
          <Users size={12} className="text-slate-400" /> {j.headCount ?? 1}
        </span>
      </td>
      <td className="px-3 py-2 align-top">
        <StatusPill status={j.status} />
      </td>
      <td className="px-3 py-2 align-top text-xs text-slate-500">
        <time dateTime={j.createdAt} title={new Date(j.createdAt).toLocaleString()}>
          {formatRelativeDuration(j.createdAt)}
        </time>
      </td>
    </tr>
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
  const label = prettyStatus(status);
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone}`}
      data-testid="jobs-status-pill"
    >
      <span className="inline-flex items-center gap-1">
        <Building2 size={10} aria-hidden />
        {label}
      </span>
    </span>
  );
}

function prettyStatus(s: string): string {
  if (s === 'PUBLISHED') return 'Active';
  if (s === 'ON_HOLD') return 'On hold';
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

// -------------------- helpers --------------------

function buildJobQueryString(q: JobListQuery): string {
  const parts: string[] = [];
  if (q.q) parts.push(`q=${encodeURIComponent(q.q)}`);
  if (q.status) parts.push(`status=${q.status}`);
  if (q.includeArchived === true) parts.push('includeArchived=true');
  if (typeof q.limit === 'number') parts.push(`limit=${q.limit}`);
  if (q.cursor) parts.push(`cursor=${encodeURIComponent(q.cursor)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function parseStatus(raw: string | null): JobStatus | undefined {
  if (!raw) return undefined;
  if ((STATUS_OPTIONS as string[]).includes(raw)) return raw as JobStatus;
  return undefined;
}
