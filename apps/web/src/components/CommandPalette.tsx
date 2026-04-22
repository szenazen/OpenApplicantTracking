'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  Briefcase,
  Home,
  Search as SearchIcon,
  User as UserIcon,
  Users,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';
import { api, type SearchResult } from '@/lib/api';
import { useAuth } from '@/lib/store';

/** Constant pinned commands surfaced before the user types. */
interface PinnedCommand {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  href: string;
}

/** A concrete, navigable row rendered in the palette list. */
interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  onSelect: () => void;
  // Used for grouping headings.
  section: 'Pinned' | 'Jobs' | 'Candidates';
}

const PINNED: PinnedCommand[] = [
  { id: 'home', label: 'Go to home', hint: 'Dashboard', icon: Home, href: '/dashboard' },
  { id: 'jobs', label: 'Jobs list', hint: 'All jobs', icon: Briefcase, href: '/dashboard' },
  {
    id: 'candidates',
    label: 'Candidates list',
    hint: 'Browse candidates',
    icon: Users,
    href: '/dashboard/candidates',
  },
];

const DEBOUNCE_MS = 150;

/**
 * Cmd+K global command palette.
 *
 * Opens from anywhere inside /dashboard via ⌘K / Ctrl+K. Empty state shows
 * a short pinned-commands list; typing 2+ chars kicks off a debounced
 * /search call that returns up to 5 jobs + 5 candidates. Enter or click
 * navigates to the hit's deep-link destination.
 *
 * Keyboard:
 *   - ArrowUp / ArrowDown move the active row (wraps).
 *   - Enter fires the active row's `onSelect`.
 *   - Escape closes the palette without navigating.
 *
 * The palette is a sibling of the dashboard layout so it's available on
 * every authenticated page without re-mounting during navigation.
 */
export function CommandPalette() {
  const router = useRouter();
  const { activeAccountId } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Global ⌘K / Ctrl+K shortcut. We also accept KeyK via `event.code` so
  // keyboard layouts that remap the K character still trigger the palette.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const keyMatch = e.key?.toLowerCase?.() === 'k' || e.code === 'KeyK';
      if (keyMatch) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Reset state whenever the palette closes so re-opening is predictable.
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults(null);
      setActiveIdx(0);
      return;
    }
    // Autofocus the input on open. A microtask is enough — the modal
    // mounts synchronously.
    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await api<SearchResult>(`/search?q=${encodeURIComponent(q)}`);
        if (!controller.signal.aborted) {
          setResults(res);
          setActiveIdx(0);
        }
      } catch {
        if (!controller.signal.aborted) setResults(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [query, open, activeAccountId]);

  const close = useCallback(() => setOpen(false), []);

  const navigateTo = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [router, close],
  );

  // Flatten pinned + search hits into a single selectable list, keeping
  // section metadata so we can render group headings and still index by
  // a single "activeIdx".
  const items = useMemo<PaletteItem[]>(() => {
    if (!results || (results.jobs.length === 0 && results.candidates.length === 0)) {
      return PINNED.map((p) => ({
        id: p.id,
        label: p.label,
        hint: p.hint,
        icon: p.icon,
        section: 'Pinned' as const,
        onSelect: () => navigateTo(p.href),
      }));
    }
    const out: PaletteItem[] = [];
    for (const j of results.jobs) {
      out.push({
        id: `job-${j.id}`,
        label: j.title,
        hint: [j.department, j.location, j.status.replace(/_/g, ' ').toLowerCase()]
          .filter(Boolean)
          .join(' · ') || undefined,
        icon: Briefcase,
        section: 'Jobs',
        onSelect: () => navigateTo(`/dashboard/jobs/${j.id}`),
      });
    }
    for (const c of results.candidates) {
      const fullName = `${c.firstName} ${c.lastName}`.trim();
      out.push({
        id: `cand-${c.id}`,
        label: fullName,
        hint: [c.currentTitle, c.currentCompany, c.email].filter(Boolean).join(' · ') || undefined,
        icon: UserIcon,
        section: 'Candidates',
        // The candidates list does not yet auto-select a row from the URL —
        // the hash lets us pass a hint to the listing page (Phase 8 will
        // consume it) without 404ing on the unknown query param today.
        onSelect: () => navigateTo(`/dashboard/candidates#${c.id}`),
      });
    }
    return out;
  }, [results, navigateTo]);

  // Keyboard navigation within the list.
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (items.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        items[activeIdx]?.onSelect();
      }
    },
    [items, activeIdx, close],
  );

  if (!open) return null;

  // Pre-compute group boundaries for rendering section headings.
  const grouped = items.reduce<Record<string, PaletteItem[]>>((acc, it) => {
    (acc[it.section] ??= []).push(it);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      data-testid="command-palette"
      onMouseDown={(e) => {
        // Clicks on the backdrop (not on the panel) close the palette.
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <SearchIcon size={16} className="text-slate-400" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs, candidates…"
            className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            aria-label="Search"
            data-testid="command-palette-input"
          />
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
            Esc
          </kbd>
        </div>
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Results"
          className="max-h-80 overflow-auto py-2"
          data-testid="command-palette-list"
        >
          {loading && items.length === 0 && (
            <li className="px-4 py-2 text-sm text-slate-500">Searching…</li>
          )}
          {!loading && items.length === 0 && (
            <li className="px-4 py-2 text-sm text-slate-500">No results.</li>
          )}
          {Object.entries(grouped).map(([section, rows]) => (
            <li key={section} className="py-1">
              <div className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {section}
              </div>
              <ul>
                {rows.map((row) => {
                  const globalIdx = items.indexOf(row);
                  const isActive = globalIdx === activeIdx;
                  const Icon = row.icon;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIdx(globalIdx)}
                        onClick={() => row.onSelect()}
                        data-testid="command-palette-item"
                        data-active={isActive ? 'true' : 'false'}
                        className={clsx(
                          'flex w-full items-center gap-3 px-4 py-2 text-left text-sm',
                          isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        <Icon size={14} className="flex-shrink-0" />
                        <span className="truncate font-medium">{row.label}</span>
                        {row.hint && (
                          <span className="ml-auto truncate text-xs text-slate-400">{row.hint}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
