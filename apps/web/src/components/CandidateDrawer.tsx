'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Check,
  Clock,
  type LucideIcon,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Star,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from 'lucide-react';
import {
  api,
  ApiError,
  ApplicationComment,
  ApplicationDetail,
  ReactionKind,
  ReactionSummary,
} from '@/lib/api';
import { useAuth } from '@/lib/store';
import { avatarColor, formatRelativeDuration, formatYearsExperience, getInitials } from '@/lib/format';

interface ActivityPatch {
  commentCount?: number;
  reactionSummary?: ReactionSummary;
}

interface Props {
  /** Application id whose drawer to render. When null/undefined the drawer is closed. */
  applicationId: string | null;
  /** Fired when the drawer should close (Esc, overlay click, X button). */
  onClose: () => void;
  /**
   * Emitted whenever the drawer mutates server-side activity (posting a
   * comment, toggling a reaction, etc.) so the parent page can feed the new
   * counts into the Kanban card badges without a full refetch.
   */
  onActivityChange?: (applicationId: string, patch: ActivityPatch) => void;
}

/**
 * Right-hand drawer that shows a candidate's full profile for the currently
 * selected application. Data comes from `GET /applications/:id` so we get:
 *   - canonical candidate fields                    (CANDIDATES table in design)
 *   - current job + current pipeline status         (APPLICATIONS + PIPELINE_STATUSES)
 *   - full status-change timeline                   (APPLICATION_STATUS_HISTORY)
 *
 * The drawer intentionally renders "read-only" for now — editing flows (status
 * change from the drawer, adding notes, re-assigning) are deliberate next steps
 * tracked separately.
 */
export function CandidateDrawer({ applicationId, onClose, onActivityChange }: Props) {
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch whenever the selected application changes.
  useEffect(() => {
    if (!applicationId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<ApplicationDetail>(`/applications/${applicationId}`)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
      })
      .catch((e: ApiError) => {
        if (cancelled) return;
        setError(e.message ?? 'Failed to load candidate');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  // Close on Escape when open.
  useEffect(() => {
    if (!applicationId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applicationId, onClose]);

  if (!applicationId) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      data-testid="candidate-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Candidate details"
    >
      <button
        type="button"
        aria-label="Close drawer"
        className="flex-1 bg-slate-900/30"
        data-testid="drawer-overlay"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Candidate</h2>
          <button
            type="button"
            aria-label="Close"
            data-testid="drawer-close"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={16} />
          </button>
        </div>

        {loading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
        {error && (
          <p role="alert" className="m-4 rounded-md bg-red-50 p-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {detail && <DrawerBody detail={detail} onActivityChange={onActivityChange} />}
      </aside>
    </div>
  );
}

function DrawerBody({
  detail,
  onActivityChange,
}: {
  detail: ApplicationDetail;
  onActivityChange?: (applicationId: string, patch: ActivityPatch) => void;
}) {
  const { candidate, job, currentStatus, transitions } = detail;
  const initials = getInitials(candidate.firstName, candidate.lastName);
  const palette = avatarColor(candidate.id);
  const yoe = formatYearsExperience(candidate.yearsExperience);

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Identity card */}
      <section className="flex items-start gap-3">
        <div
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-base font-semibold ${palette.bg} ${palette.fg}`}
          aria-hidden
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-slate-900" data-testid="drawer-candidate-name">
            {candidate.firstName} {candidate.lastName}
          </h3>
          {candidate.headline && (
            <p className="mt-0.5 truncate text-sm text-slate-500">{candidate.headline}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {candidate.currentTitle && (
              <span className="inline-flex items-center gap-1">
                <Briefcase size={12} /> {candidate.currentTitle}
                {candidate.currentCompany ? ` @ ${candidate.currentCompany}` : ''}
              </span>
            )}
            {!candidate.currentTitle && candidate.currentCompany && (
              <span className="inline-flex items-center gap-1">
                <Building2 size={12} /> {candidate.currentCompany}
              </span>
            )}
            {candidate.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} /> {candidate.location}
              </span>
            )}
            {yoe && (
              <span className="inline-flex items-center gap-1" title="Years of experience">
                <Clock size={12} /> {yoe} exp
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Contact */}
      {(candidate.email || candidate.phone) && (
        <section className="rounded-md border border-slate-200 p-3">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Contact</h4>
          <ul className="flex flex-col gap-1.5 text-sm text-slate-700">
            {candidate.email && (
              <li className="flex items-center gap-2">
                <Mail size={14} className="text-slate-400" />
                <a href={`mailto:${candidate.email}`} className="truncate hover:underline">
                  {candidate.email}
                </a>
              </li>
            )}
            {candidate.phone && (
              <li className="flex items-center gap-2">
                <Phone size={14} className="text-slate-400" />
                <span className="truncate">{candidate.phone}</span>
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Current application context */}
      <section className="rounded-md border border-slate-200 p-3">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Current application
        </h4>
        <p className="text-sm text-slate-700">
          <span className="font-semibold">{job.title}</span>
          {job.department ? ` · ${job.department}` : ''}
          {job.location ? ` · ${job.location}` : ''}
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
          <span
            className="inline-block h-2 w-2 rounded-full"
            aria-hidden
            style={{ backgroundColor: currentStatus.color || categoryColor(currentStatus.category) }}
          />
          <span data-testid="drawer-current-status">{currentStatus.name}</span>
          <span className="text-slate-400">·</span>
          <span>{formatRelativeDuration(detail.lastTransitionAt) || 'just now'} in stage</span>
        </div>
      </section>

      {/* Summary */}
      {candidate.summary && (
        <section>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Summary</h4>
          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{candidate.summary}</p>
        </section>
      )}

      {/* Skills — renders CANDIDATE_SKILLS from the design (name + optional
          1..5 proficiency dots). */}
      {candidate.skills && candidate.skills.length > 0 && (
        <section data-testid="drawer-skills">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Skills</h4>
          <ul className="flex flex-wrap gap-1.5">
            {candidate.skills.map((s) => (
              <li
                key={s.skillId}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700"
                title={s.level ? `Proficiency: ${s.level}/5` : undefined}
                data-testid="drawer-skill-chip"
              >
                <span className="truncate">{s.name}</span>
                {s.level != null && <SkillLevelDots level={s.level} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Reactions bar + comments — HR + hiring manager collaboration. */}
      <ReactionsBar
        applicationId={detail.id}
        initial={detail.reactionSummary}
        onChange={(summary) => onActivityChange?.(detail.id, { reactionSummary: summary })}
      />
      <CommentsSection
        applicationId={detail.id}
        initialCount={detail.commentCount}
        onCountChange={(commentCount) => onActivityChange?.(detail.id, { commentCount })}
      />

      {/* Timeline */}
      <section data-testid="drawer-timeline">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Status history
        </h4>
        {transitions.length === 0 ? (
          <p className="text-sm text-slate-500">No transitions yet.</p>
        ) : (
          <ol className="flex flex-col gap-3 border-l border-slate-200 pl-4">
            {transitions
              .slice()
              .reverse()
              .map((t) => (
                <TimelineItem key={t.id} item={t} />
              ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/**
 * Row of three toggle buttons (👍 / 👎 / ⭐) that reflect the viewer's own
 * reaction state plus the aggregate count across the team. Mutations are
 * optimistic — if the server rejects we rollback and surface the error.
 */
function ReactionsBar({
  applicationId,
  initial,
  onChange,
}: {
  applicationId: string;
  initial: ReactionSummary | undefined;
  onChange?: (summary: ReactionSummary) => void;
}) {
  const [summary, setSummary] = useState<ReactionSummary>(
    initial ?? { counts: { THUMBS_UP: 0, THUMBS_DOWN: 0, STAR: 0 }, myReactions: [] },
  );
  const [busy, setBusy] = useState<ReactionKind | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (initial) setSummary(initial);
  }, [initial]);

  async function toggle(kind: ReactionKind) {
    if (busy) return;
    const mine = summary.myReactions.includes(kind);
    const optimistic: ReactionSummary = {
      counts: { ...summary.counts, [kind]: summary.counts[kind] + (mine ? -1 : 1) },
      myReactions: mine ? summary.myReactions.filter((k) => k !== kind) : [...summary.myReactions, kind],
    };
    setSummary(optimistic);
    setBusy(kind);
    setErr(null);
    try {
      const res = await api<ReactionSummary>(
        `/applications/${applicationId}/reactions/${kind}`,
        { method: mine ? 'DELETE' : 'PUT' },
      );
      setSummary(res);
      onChange?.(res);
    } catch (e) {
      setSummary(summary);
      setErr((e as Error).message ?? 'Failed to update reaction');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section data-testid="drawer-reactions">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Team take
      </h4>
      <div className="flex items-center gap-2">
        <ReactionButton
          kind="THUMBS_UP"
          Icon={ThumbsUp}
          active={summary.myReactions.includes('THUMBS_UP')}
          count={summary.counts.THUMBS_UP}
          onClick={() => toggle('THUMBS_UP')}
          testId="reaction-thumbs-up"
          activeClass="bg-emerald-50 text-emerald-700 ring-emerald-300"
        />
        <ReactionButton
          kind="THUMBS_DOWN"
          Icon={ThumbsDown}
          active={summary.myReactions.includes('THUMBS_DOWN')}
          count={summary.counts.THUMBS_DOWN}
          onClick={() => toggle('THUMBS_DOWN')}
          testId="reaction-thumbs-down"
          activeClass="bg-rose-50 text-rose-700 ring-rose-300"
        />
        <ReactionButton
          kind="STAR"
          Icon={Star}
          active={summary.myReactions.includes('STAR')}
          count={summary.counts.STAR}
          onClick={() => toggle('STAR')}
          testId="reaction-star"
          activeClass="bg-amber-50 text-amber-700 ring-amber-300"
        />
      </div>
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
    </section>
  );
}

function ReactionButton({
  Icon,
  active,
  count,
  onClick,
  testId,
  activeClass,
}: {
  kind: ReactionKind;
  Icon: LucideIcon;
  active: boolean;
  count: number;
  onClick: () => void;
  testId: string;
  activeClass: string;
}) {
  const base =
    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors';
  const idle = 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} ${active ? activeClass : idle}`}
      data-testid={testId}
    >
      <Icon size={12} className={active ? 'fill-current' : ''} />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

/**
 * Comments thread on the current application. Uses the same reliability
 * patterns as {@link JobNotesPage}:
 *   - POST carries an `Idempotency-Key`
 *   - PATCH/DELETE echo `expectedVersion`
 *   - 409s trigger a re-fetch rather than a silent overwrite
 */
function CommentsSection({
  applicationId,
  initialCount,
  onCountChange,
}: {
  applicationId: string;
  initialCount?: number;
  onCountChange?: (count: number) => void;
}) {
  const me = useAuth((s) => s.me);
  const [comments, setComments] = useState<ApplicationComment[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [composeBody, setComposeBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');

  const refresh = useCallback(async () => {
    try {
      const list = await api<ApplicationComment[]>(`/applications/${applicationId}/comments`);
      setComments(list);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to load comments');
    }
  }, [applicationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Bubble the live comment count upward so Kanban badges stay in sync.
  useEffect(() => {
    if (!onCountChange) return;
    if (comments === null) return;
    onCountChange(comments.length);
  }, [comments, onCountChange]);
  void initialCount;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = composeBody.trim();
    if (!body || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const created = await api<ApplicationComment>(`/applications/${applicationId}/comments`, {
        method: 'POST',
        body: { body },
        headers: { 'Idempotency-Key': newIdempotencyKey() },
      });
      setComments((prev) => (prev ? [created, ...prev] : [created]));
      setComposeBody('');
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to post comment');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(c: ApplicationComment) {
    setEditingId(c.id);
    setEditingBody(c.body);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingBody('');
  }

  async function saveEdit(c: ApplicationComment) {
    const body = editingBody.trim();
    if (!body) return;
    try {
      const updated = await api<ApplicationComment>(`/comments/${c.id}`, {
        method: 'PATCH',
        body: { body, expectedVersion: c.version },
      });
      setComments((prev) => prev?.map((x) => (x.id === c.id ? updated : x)) ?? null);
      cancelEdit();
      setErr(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr('Someone else just edited this comment — refreshing.');
        cancelEdit();
        await refresh();
      } else {
        setErr((e as Error).message ?? 'Failed to update comment');
      }
    }
  }

  async function remove(c: ApplicationComment) {
    if (!confirm('Delete this comment?')) return;
    try {
      await api(`/comments/${c.id}?expectedVersion=${c.version}`, { method: 'DELETE' });
      setComments((prev) => prev?.filter((x) => x.id !== c.id) ?? null);
      setErr(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr('Someone else just edited this comment — refreshing.');
        await refresh();
      } else {
        setErr((e as Error).message ?? 'Failed to delete comment');
      }
    }
  }

  return (
    <section data-testid="drawer-comments">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Comments {comments ? <span className="text-slate-300">({comments.length})</span> : null}
      </h4>

      <form onSubmit={onSubmit} className="mb-3 space-y-2">
        <textarea
          value={composeBody}
          onChange={(e) => setComposeBody(e.target.value)}
          rows={2}
          maxLength={5000}
          placeholder="Add a comment for the hiring team…"
          className="block w-full resize-y rounded-md border border-slate-300 px-2.5 py-1.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          data-testid="comment-compose"
        />
        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={!composeBody.trim() || saving}
            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="comment-submit"
          >
            {saving ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>

      {err && (
        <p className="mb-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700 ring-1 ring-inset ring-rose-200">
          {err}
        </p>
      )}

      {!comments ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
          No comments yet — start the conversation.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="comment-list">
          {comments.map((c) => {
            const isAuthor = me?.id === c.authorUserId;
            const isEditing = editingId === c.id;
            return (
              <li
                key={c.id}
                className="rounded-md border border-slate-200 bg-white p-2.5"
                data-testid="comment-item"
              >
                <header className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <CommentAvatar
                      name={c.author?.displayName ?? c.author?.email ?? '?'}
                      url={c.author?.avatarUrl}
                    />
                    <span className="font-medium text-slate-700">
                      {c.author?.displayName ?? c.author?.email ?? 'Unknown'}
                    </span>
                    <span className="text-slate-400" title={c.createdAt}>
                      {formatRelativeDuration(c.createdAt) || 'just now'}
                      {c.updatedAt !== c.createdAt && ' (edited)'}
                    </span>
                  </div>
                  {isAuthor && !isEditing && (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label="Edit"
                        data-testid="comment-edit"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c)}
                        className="rounded p-1 text-rose-400 hover:bg-rose-50"
                        aria-label="Delete"
                        data-testid="comment-delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </header>
                {isEditing ? (
                  <div className="mt-1 space-y-1.5">
                    <textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      rows={2}
                      maxLength={5000}
                      className="block w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      data-testid="comment-edit-input"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => saveEdit(c)}
                        disabled={!editingBody.trim()}
                        className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
                        data-testid="comment-save"
                      >
                        <Check size={10} /> Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                      >
                        <X size={10} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800" data-testid="comment-body">
                    {c.body}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CommentAvatar({ name, url }: { name: string; url: string | null | undefined }) {
  const initials = name
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="h-4 w-4 rounded-full object-cover" />;
  }
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-brand-100 text-[9px] font-semibold text-brand-700">
      {initials || '?'}
    </span>
  );
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function TimelineItem({ item }: { item: ApplicationDetail['transitions'][number] }) {
  const when = formatRelativeDuration(item.createdAt);
  const actor = item.byUserDisplayName || 'System';
  return (
    <li className="relative" data-testid="drawer-timeline-item">
      <span
        className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white"
        aria-hidden
      />
      <div className="text-xs text-slate-500">
        <span title={new Date(item.createdAt).toLocaleString()}>{when || 'just now'}</span>
        <span className="mx-1 text-slate-300">·</span>
        <span>{actor}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-700">
        {item.fromStatusName ? (
          <>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
              {item.fromStatusName}
            </span>
            <ArrowRight size={12} className="text-slate-400" />
          </>
        ) : (
          <span className="text-xs text-slate-400">Created in</span>
        )}
        <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-medium text-brand-700">
          {item.toStatusName ?? '—'}
        </span>
      </div>
      {item.reason && <p className="mt-1 text-xs text-slate-500">“{item.reason}”</p>}
    </li>
  );
}

/** Tiny 1..5 proficiency indicator. Small enough to sit inline in a chip. */
function SkillLevelDots({ level }: { level: number }) {
  const clamped = Math.max(1, Math.min(5, Math.round(level)));
  return (
    <span
      className="ml-0.5 flex gap-0.5"
      aria-label={`Proficiency ${clamped} out of 5`}
      data-testid="drawer-skill-level"
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          aria-hidden
          className={`h-1 w-1 rounded-full ${i <= clamped ? 'bg-brand-600' : 'bg-slate-300'}`}
        />
      ))}
    </span>
  );
}

/** Fallback dot color when a status has no explicit color — mirrors KanbanBoard. */
function categoryColor(category: string): string {
  switch (category) {
    case 'NEW':
      return '#60a5fa';
    case 'HIRED':
      return '#22c55e';
    case 'DROPPED':
      return '#ef4444';
    case 'IN_PROGRESS':
    default:
      return '#94a3b8';
  }
}
