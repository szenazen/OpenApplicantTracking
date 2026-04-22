'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Briefcase,
  FileText,
  MessageSquare,
  Pencil,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { api, type ActivityEntry, type ActivityPage } from '@/lib/api';
import { useJob } from '../JobContext';

/**
 * "Activities" tab — single chronological feed of everything that happened
 * on this job.
 *
 * Data comes from `GET /jobs/:id/activities`, which is a projection over the
 * regional `AuditEvent` log filtered by `metadata.jobId`. Pagination is
 * keyset on `createdAt` (`?before=<iso>`), so the feed is stable under
 * concurrent writes — no duplicate or skipped rows as new events land.
 *
 * Each entry is rendered by action-kind-specific renderers so the UI can
 * pull useful bits out of `metadata` (e.g. from/to status for moves, reaction
 * kind for reactions) rather than showing raw JSON.
 */
export default function JobActivitiesPage() {
  const { job, pipeline } = useJob();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    try {
      const page = await api<ActivityPage>(`/jobs/${job.id}/activities?limit=50`);
      setEntries(page.entries);
      setNextBefore(page.nextBefore);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load activities');
    }
  }, [job.id]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  async function loadMore() {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api<ActivityPage>(
        `/jobs/${job.id}/activities?limit=50&before=${encodeURIComponent(nextBefore)}`,
      );
      setEntries((prev) => [...(prev ?? []), ...page.entries]);
      setNextBefore(page.nextBefore);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load more activities');
    } finally {
      setLoadingMore(false);
    }
  }

  const statusNames = new Map(pipeline.statuses.map((s) => [s.id, s.name] as const));

  return (
    <div className="overflow-auto p-6" data-testid="job-activities-page">
      <div className="max-w-3xl space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">Activity feed</h2>
          <button
            type="button"
            onClick={loadInitial}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
            data-testid="activities-refresh"
          >
            Refresh
          </button>
        </header>

        {err && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            {err}
          </p>
        )}

        {!entries ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
            No activity yet. Actions like applications, moves, notes and reactions will show up here.
          </p>
        ) : (
          <>
            <ol className="space-y-3" data-testid="activity-list">
              {entries.map((e) => (
                <ActivityRow key={e.id} entry={e} statusNames={statusNames} jobId={job.id} />
              ))}
            </ol>
            {nextBefore && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                  data-testid="activities-load-more"
                >
                  {loadingMore ? 'Loading…' : 'Load older activity'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActivityRow({
  entry,
  statusNames,
  jobId,
}: {
  entry: ActivityEntry;
  statusNames: Map<string, string>;
  jobId: string;
}) {
  const { icon: Icon, tone } = kindVisual(entry.action);
  const actorName = entry.actor?.displayName ?? entry.actor?.email ?? 'Someone';
  const href = deepLink(entry, jobId);
  const body = (
    <div className="flex gap-3">
      <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`}>
        <Icon size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-800" data-testid="activity-summary">
          <span className="font-medium">{actorName}</span>{' '}
          <ActivityVerb entry={entry} statusNames={statusNames} />
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400" title={entry.createdAt}>
          {formatRelative(entry.createdAt)}
        </p>
      </div>
    </div>
  );
  return (
    <li data-testid="activity-item" data-activity-action={entry.action}>
      {href ? (
        <Link
          href={href}
          data-testid="activity-link"
          className="block rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
        >
          {body}
        </Link>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">{body}</div>
      )}
    </li>
  );
}

/**
 * Resolve an audit-event row to the UI page where it "lives".
 * - Application events open the Kanban with the candidate drawer pre-opened.
 * - Comment / reaction events behave the same since they're scoped to an application.
 * - Note events open the Notes tab.
 * - Job-member events open the Team tab.
 * - Job updates open the Summary tab.
 * Falls back to `null` for unknown action kinds, which keeps the row as a
 * static card rather than silently linking to the wrong place.
 */
function deepLink(entry: ActivityEntry, jobId: string): string | null {
  const m = entry.metadata ?? {};
  const applicationId = typeof m.applicationId === 'string' ? (m.applicationId as string) : null;
  const a = entry.action;
  if (a.startsWith('application.') || a.startsWith('comment.') || a.startsWith('reaction.')) {
    // The Kanban page lives at the job root. A query hint is included so
    // Phase 6's drawer auto-open can pick the application up without a
    // separate trip to the Activities tab.
    return applicationId
      ? `/dashboard/jobs/${jobId}?application=${applicationId}`
      : `/dashboard/jobs/${jobId}`;
  }
  if (a.startsWith('note.')) return `/dashboard/jobs/${jobId}/notes`;
  if (a.startsWith('job-member.')) return `/dashboard/jobs/${jobId}/team`;
  if (a === 'job.updated') return `/dashboard/jobs/${jobId}/summary`;
  return null;
}

/**
 * Action-specific human summary. Kept as a component (not a plain string) so
 * we can mix structured inline bits (e.g. from -> to stage pills) without
 * losing i18n flexibility later.
 */
function ActivityVerb({
  entry,
  statusNames,
}: {
  entry: ActivityEntry;
  statusNames: Map<string, string>;
}) {
  const m = entry.metadata ?? {};
  switch (entry.action) {
    case 'application.created':
      return <>added a candidate to the pipeline.</>;
    case 'application.moved': {
      const from = typeof m.fromStatusId === 'string' ? statusNames.get(m.fromStatusId) ?? '—' : '—';
      const to = typeof m.toStatusId === 'string' ? statusNames.get(m.toStatusId) ?? '—' : '—';
      const reason = typeof m.reason === 'string' ? m.reason : '';
      return (
        <>
          moved a candidate{' '}
          <StagePill>{from}</StagePill>
          <ArrowRight size={12} className="mx-1 inline-block text-slate-400" aria-hidden />
          <StagePill>{to}</StagePill>
          {reason && <span className="text-slate-500"> — {reason}</span>}.
        </>
      );
    }
    case 'comment.created':
      return <>added a comment on a candidate.</>;
    case 'comment.updated':
      return <>edited a comment on a candidate.</>;
    case 'comment.deleted':
      return <>deleted a comment on a candidate.</>;
    case 'reaction.added': {
      const label = reactionLabel(m.kind);
      return <>reacted <StagePill>{label}</StagePill> on a candidate.</>;
    }
    case 'reaction.removed': {
      const label = reactionLabel(m.kind);
      return <>removed their <StagePill>{label}</StagePill> reaction.</>;
    }
    case 'note.created':
      return <>posted a note on the job.</>;
    case 'note.updated':
      return <>edited a note on the job.</>;
    case 'note.deleted':
      return <>deleted a note on the job.</>;
    case 'job.updated': {
      const changed = Array.isArray(m.changedFields) ? (m.changedFields as string[]) : [];
      if (changed.includes('status')) {
        const diff = (m.diff as Record<string, { from: unknown; to: unknown }> | undefined)?.status;
        const from = typeof diff?.from === 'string' ? diff!.from : '—';
        const to = typeof diff?.to === 'string' ? diff!.to : '—';
        return (
          <>
            changed job status{' '}
            <StagePill>{from.replace(/_/g, ' ')}</StagePill>
            <ArrowRight size={12} className="mx-1 inline-block text-slate-400" aria-hidden />
            <StagePill>{to.replace(/_/g, ' ')}</StagePill>.
          </>
        );
      }
      if (changed.length === 0) return <>updated the job.</>;
      const pretty = changed.map((f) => f.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ');
      return <>updated job ({pretty}).</>;
    }
    default:
      return <>{entry.action.replace(/\./g, ' ')}.</>;
  }
}

function StagePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
      {children}
    </span>
  );
}

function reactionLabel(kind: unknown): string {
  if (kind === 'THUMBS_UP') return '👍 thumbs up';
  if (kind === 'THUMBS_DOWN') return '👎 thumbs down';
  if (kind === 'STAR') return '⭐ star';
  return 'reaction';
}

/** Icon + tailwind color classes per action kind. */
function kindVisual(action: string): { icon: LucideIcon; tone: string } {
  if (action.startsWith('application.created')) {
    return { icon: UserPlus, tone: 'bg-blue-50 text-blue-600 ring-1 ring-inset ring-blue-100' };
  }
  if (action.startsWith('application.moved')) {
    return { icon: ArrowRight, tone: 'bg-violet-50 text-violet-600 ring-1 ring-inset ring-violet-100' };
  }
  if (action.startsWith('comment.')) {
    const icon = action.endsWith('.deleted') ? Trash2 : action.endsWith('.updated') ? Pencil : MessageSquare;
    return { icon, tone: 'bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100' };
  }
  if (action.startsWith('reaction.')) {
    const icon =
      action.endsWith('.removed')
        ? Trash2
        : action.endsWith('.added')
        ? (action.includes('STAR') ? Star : ThumbsUp)
        : ThumbsDown;
    return { icon, tone: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100' };
  }
  if (action.startsWith('note.')) {
    const icon = action.endsWith('.deleted') ? Trash2 : action.endsWith('.updated') ? Pencil : FileText;
    return { icon, tone: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100' };
  }
  if (action.startsWith('job.')) {
    return { icon: Briefcase, tone: 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-100' };
  }
  return { icon: FileText, tone: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200' };
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.round((now - then) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
