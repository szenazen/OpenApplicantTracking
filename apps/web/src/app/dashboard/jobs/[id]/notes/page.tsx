'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { api, ApiError, type JobNote } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { useJob } from '../JobContext';

/**
 * "Notes" tab — collaborative free-form notes attached to the job.
 *
 * Respects the reliability contract from `design/ATS-design.drawio.xml` Notes:
 *   - every POST sends an `Idempotency-Key` so double-submits are safe,
 *   - every PATCH/DELETE echoes `expectedVersion` so concurrent edits are
 *     rejected with a 409 instead of silently overwriting each other.
 *
 * Authoring affordances (edit / delete) only appear to the note's author.
 */
export default function JobNotesPage() {
  const { job } = useJob();
  const me = useAuth((s) => s.me);
  const [notes, setNotes] = useState<JobNote[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [composeBody, setComposeBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');

  const refresh = useCallback(async () => {
    try {
      const list = await api<JobNote[]>(`/jobs/${job.id}/notes`);
      setNotes(list);
      setErr(null);
    } catch (e: any) {
      setErr(e.message ?? 'Failed to load notes');
    }
  }, [job.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = composeBody.trim();
    if (!body || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const created = await api<JobNote>(`/jobs/${job.id}/notes`, {
        method: 'POST',
        body: { body },
        headers: { 'Idempotency-Key': newIdempotencyKey() },
      });
      setNotes((prev) => (prev ? [created, ...prev] : [created]));
      setComposeBody('');
    } catch (e: any) {
      setErr(e.message ?? 'Failed to save note');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(n: JobNote) {
    setEditingId(n.id);
    setEditingBody(n.body);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingBody('');
  }

  async function saveEdit(n: JobNote) {
    const body = editingBody.trim();
    if (!body) return;
    try {
      const updated = await api<JobNote>(`/notes/${n.id}`, {
        method: 'PATCH',
        body: { body, expectedVersion: n.version },
      });
      setNotes((prev) => prev?.map((x) => (x.id === n.id ? updated : x)) ?? null);
      cancelEdit();
      setErr(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr('Someone else just edited this note — refreshing.');
        cancelEdit();
        await refresh();
      } else {
        setErr((e as Error).message ?? 'Failed to update note');
      }
    }
  }

  async function remove(n: JobNote) {
    if (!confirm('Delete this note?')) return;
    try {
      await api(`/notes/${n.id}?expectedVersion=${n.version}`, { method: 'DELETE' });
      setNotes((prev) => prev?.filter((x) => x.id !== n.id) ?? null);
      setErr(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setErr('Someone else just edited this note — refreshing.');
        await refresh();
      } else {
        setErr((e as Error).message ?? 'Failed to delete note');
      }
    }
  }

  return (
    <div className="overflow-auto p-6" data-testid="job-notes-page">
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800">Add a note</h2>
          <form onSubmit={onSubmit} className="mt-2 space-y-2">
            <textarea
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              placeholder="Share interview feedback, next steps, or context…"
              maxLength={5000}
              rows={3}
              className="block w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              data-testid="note-compose"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">
                {composeBody.trim().length}/5000
              </span>
              <button
                type="submit"
                disabled={!composeBody.trim() || saving}
                className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="note-submit"
              >
                {saving ? 'Posting…' : 'Post note'}
              </button>
            </div>
          </form>
        </section>

        {err && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            {err}
          </p>
        )}

        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-800">
            Notes {notes ? <span className="text-slate-400">({notes.length})</span> : null}
          </h2>
          {!notes ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
              No notes yet. Be the first to leave one.
            </p>
          ) : (
            <ul className="space-y-3" data-testid="note-list">
              {notes.map((n) => {
                const isAuthor = me?.id === n.authorUserId;
                const isEditing = editingId === n.id;
                return (
                  <li
                    key={n.id}
                    className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                    data-testid="note-item"
                  >
                    <header className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                      <div className="flex items-center gap-2">
                        <Avatar name={n.author?.displayName ?? n.author?.email ?? '?'} url={n.author?.avatarUrl} />
                        <span className="font-medium text-slate-700">
                          {n.author?.displayName ?? n.author?.email ?? 'Unknown'}
                        </span>
                        <span className="text-slate-400" title={n.createdAt}>
                          {formatRelative(n.createdAt)}
                          {n.updatedAt !== n.createdAt && ' (edited)'}
                        </span>
                      </div>
                      {isAuthor && !isEditing && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(n)}
                            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            aria-label="Edit"
                            data-testid="note-edit"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => remove(n)}
                            className="rounded p-1 text-rose-500 hover:bg-rose-50"
                            aria-label="Delete"
                            data-testid="note-delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </header>

                    {isEditing ? (
                      <div className="mt-1 space-y-2">
                        <textarea
                          value={editingBody}
                          onChange={(e) => setEditingBody(e.target.value)}
                          rows={3}
                          maxLength={5000}
                          className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          data-testid="note-edit-input"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(n)}
                            disabled={!editingBody.trim()}
                            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                            data-testid="note-save"
                          >
                            <Check size={12} /> Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          >
                            <X size={12} /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800" data-testid="note-body">
                        {n.body}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Avatar({ name, url }: { name: string; url: string | null | undefined }) {
  const initials = name
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="h-5 w-5 rounded-full object-cover" />;
  }
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700">
      {initials || '?'}
    </span>
  );
}

/**
 * Generate a small random token suitable for an `Idempotency-Key` header.
 * We prefer `crypto.randomUUID` where available and fall back to a time+random
 * combo on older browsers (Safari < 15.4 etc.).
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
