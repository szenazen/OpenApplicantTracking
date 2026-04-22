'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import clsx from 'clsx';
import { api, type NotificationEntry, type NotificationPage } from '@/lib/api';
import { useAuth } from '@/lib/store';

const POLL_INTERVAL_MS = 30_000;

/**
 * Header bell: polls `/notifications/unread-count` every 30s, reveals the
 * inbox on click, and deep-links each entry to the relevant page.
 *
 * Why polling instead of WebSockets? The realtime gateway today is scoped
 * to a job room (for Kanban moves). Putting user-scoped push behind it
 * would require a second join event + room topology, which is not yet
 * worth the complexity — the bell must also work on pages that don't
 * open a socket (e.g. settings). A 30s poll is effectively invisible to
 * users and hits a single indexed COUNT on the backend.
 */
export function NotificationsBell() {
  const { activeAccountId } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState(0);
  const [entries, setEntries] = useState<NotificationEntry[]>([]);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Lightweight count poll — runs even when the popover is closed so the
  // badge stays fresh on any page.
  useEffect(() => {
    if (!activeAccountId) {
      setUnread(0);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api<{ unread: number }>('/notifications/unread-count');
        if (!cancelled) setUnread(res.unread);
      } catch {
        // Silent — the badge is best-effort. A transient 401/network blip
        // shouldn't spam console errors every 30s.
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeAccountId]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api<NotificationPage>('/notifications?limit=20');
      setEntries(page.entries);
      setUnread(page.unreadCount);
    } finally {
      setLoading(false);
    }
  }, []);

  const onToggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) void loadEntries();
      return next;
    });
  }, [loadEntries]);

  const markAllRead = useCallback(async () => {
    // Optimistic: flip all local entries + zero the badge immediately.
    setEntries((rows) => rows.map((r) => ({ ...r, readAt: r.readAt ?? new Date().toISOString() })));
    setUnread(0);
    try {
      await api('/notifications/mark-read', { method: 'POST', body: { all: true } });
    } catch {
      // Re-sync on failure so the UI doesn't silently lie about state.
      void loadEntries();
    }
  }, [loadEntries]);

  const onEntryClick = useCallback(
    async (entry: NotificationEntry) => {
      if (!entry.readAt) {
        setEntries((rows) =>
          rows.map((r) => (r.id === entry.id ? { ...r, readAt: new Date().toISOString() } : r)),
        );
        setUnread((n) => Math.max(0, n - 1));
        try {
          await api('/notifications/mark-read', { method: 'POST', body: { ids: [entry.id] } });
        } catch {
          void loadEntries();
        }
      }
      setOpen(false);
    },
    [loadEntries],
  );

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={onToggle}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="notifications-bell"
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            data-testid="notifications-badge"
            className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Notifications"
          data-testid="notifications-popover"
          className="absolute right-0 z-40 mt-2 w-96 rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <h3 className="text-sm font-semibold text-slate-800">Notifications</h3>
            <button
              type="button"
              onClick={markAllRead}
              disabled={unread === 0}
              data-testid="notifications-mark-all"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 enabled:hover:bg-slate-100 enabled:hover:text-slate-700 disabled:opacity-50"
            >
              <CheckCheck size={12} /> Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-auto" data-testid="notifications-list">
            {loading && entries.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">You&apos;re all caught up.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {entries.map((n) => (
                  <NotificationRow key={n.id} entry={n} onClick={() => onEntryClick(n)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationRow({
  entry,
  onClick,
}: {
  entry: NotificationEntry;
  onClick: () => void;
}) {
  const href = resourceToHref(entry.resource, entry.metadata);
  const actorName = entry.actor?.displayName ?? entry.actor?.email ?? 'Someone';
  const kindLabel = kindToLabel(entry.kind);
  const snippet = typeof entry.metadata.snippet === 'string' ? (entry.metadata.snippet as string) : '';
  const timeAgo = relativeTime(entry.createdAt);

  const content = (
    <div className="flex gap-3 p-3 text-sm">
      <div
        className={clsx(
          'mt-1 h-2 w-2 flex-shrink-0 rounded-full',
          entry.readAt ? 'bg-transparent' : 'bg-brand-500',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-slate-800">
          <span className="font-medium">{actorName}</span>{' '}
          <span className="text-slate-500">{kindLabel}</span>
        </p>
        {snippet && (
          <p className="mt-0.5 line-clamp-2 text-slate-600">{snippet}</p>
        )}
        <p className="mt-1 text-xs text-slate-400">{timeAgo}</p>
      </div>
    </div>
  );

  return (
    <li data-testid="notifications-item" data-unread={entry.readAt ? 'false' : 'true'}>
      {href ? (
        <Link href={href} onClick={onClick} className="block hover:bg-slate-50">
          {content}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className="w-full text-left hover:bg-slate-50">
          {content}
        </button>
      )}
    </li>
  );
}

function kindToLabel(kind: NotificationEntry['kind']): string {
  switch (kind) {
    case 'MENTION':
      return 'mentioned you';
    case 'ASSIGNMENT':
      return 'added you to a job';
    case 'REPLY':
      return 'replied on a candidate';
  }
}

/**
 * Resources are stored in the compact `kind:id` form on the server so the
 * API never has to know about frontend route shape. Map them to the
 * corresponding Next.js route here; fall through to `null` for future
 * resource kinds we haven't wired a destination for yet.
 */
function resourceToHref(resource: string, metadata: Record<string, unknown>): string | null {
  const [kind, id] = resource.split(':', 2);
  if (!kind || !id) return null;
  const jobId = typeof metadata.jobId === 'string' ? (metadata.jobId as string) : null;
  if (kind === 'application') {
    return jobId ? `/dashboard/jobs/${jobId}/kanban?application=${id}` : null;
  }
  if (kind === 'job') return `/dashboard/jobs/${id}`;
  return null;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
