'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import type { ApplicationCard, PipelineStatus } from '@/lib/api';

/**
 * Confirmation modal for stage transitions that have downstream meaning:
 *
 *   - DROPPED: a recruiter is rejecting a candidate; we surface preset
 *     reasons (matching the most common ATS reason codes) so the data is
 *     analyzable later, and require a non-empty reason so reports aren't
 *     full of blanks. Free-text "other" is always available.
 *   - HIRED: irreversible-ish; we ask for a quick confirmation and accept
 *     an optional note (e.g. "starts Mar 1") that is saved as the
 *     transition's reason.
 *
 * The dialog is purely presentational — the host is responsible for
 * actually doing the move (optimistic + API). On confirm we hand back the
 * `reason` string; on cancel we hand back nothing and the host should
 * leave the board state untouched.
 *
 * This is intentionally NOT a drop replacement for the move endpoint
 * itself — we already pass `reason` through `PATCH /applications/:id/move`,
 * so no schema change is needed. The dialog is a UX layer on top.
 */
export interface PendingTransition {
  card: ApplicationCard;
  fromStatus: PipelineStatus;
  toStatus: PipelineStatus;
  /** All the data the host needs to actually call /move once we confirm. */
  toPosition: number;
}

interface Props {
  pending: PendingTransition | null;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
}

const DROP_REASONS: Array<{ id: string; label: string }> = [
  { id: 'experience-mismatch', label: 'Experience / skill mismatch' },
  { id: 'compensation', label: 'Compensation mismatch' },
  { id: 'location', label: 'Location / relocation' },
  { id: 'culture-fit', label: 'Culture fit' },
  { id: 'communication', label: 'Communication concerns' },
  { id: 'withdrew', label: 'Candidate withdrew' },
  { id: 'no-show', label: 'Did not respond / no-show' },
  { id: 'other', label: 'Other' },
];

export function StageTransitionDialog({ pending, onCancel, onConfirm }: Props) {
  const [presetId, setPresetId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!pending) return;
    setPresetId(null);
    setNote('');
    setBusy(false);
    setErr(null);
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, busy, onCancel]);

  if (!pending) return null;

  const isDrop = pending.toStatus.category === 'DROPPED';
  const isHire = pending.toStatus.category === 'HIRED';
  const candidateName = `${pending.card.candidate.firstName} ${pending.card.candidate.lastName}`;

  function buildReason(): string {
    const trimmedNote = note.trim();
    if (isDrop) {
      const presetLabel = DROP_REASONS.find((r) => r.id === presetId)?.label ?? '';
      // Preset + optional free-text note. Recruiters usually want both:
      // a code for analytics + context for the team reading the timeline.
      if (presetLabel && trimmedNote) return `${presetLabel}: ${trimmedNote}`;
      if (presetLabel) return presetLabel;
      return trimmedNote;
    }
    return trimmedNote;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const reason = buildReason();
    if (isDrop && reason === '') {
      setErr('Please pick a reason or write a short note.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to apply change');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stage-transition-title"
      data-testid="stage-transition-dialog"
    >
      <form onSubmit={onSubmit} className="my-12 w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div className="flex items-start gap-3">
            <div
              className={
                'flex h-9 w-9 items-center justify-center rounded-full ' +
                (isDrop
                  ? 'bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-100'
                  : 'bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100')
              }
            >
              {isDrop ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
            </div>
            <div>
              <h2 id="stage-transition-title" className="text-base font-semibold text-slate-900">
                {isDrop
                  ? `Drop ${candidateName}?`
                  : isHire
                  ? `Mark ${candidateName} as hired?`
                  : `Move ${candidateName}`}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Moving from <Pill>{pending.fromStatus.name}</Pill> to{' '}
                <Pill tone={isDrop ? 'danger' : isHire ? 'success' : 'neutral'}>
                  {pending.toStatus.name}
                </Pill>
                .
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {isDrop && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Reason <span className="text-rose-600">*</span>
              </label>
              <div className="flex flex-wrap gap-1.5" data-testid="drop-reason-presets">
                {DROP_REASONS.map((r) => {
                  const active = presetId === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setPresetId(active ? null : r.id)}
                      className={
                        'rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors ' +
                        (active
                          ? 'bg-rose-600 text-white ring-rose-700'
                          : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50')
                      }
                      data-testid={`drop-reason-${r.id}`}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="stage-transition-note"
              className="mb-1 block text-xs font-medium text-slate-700"
            >
              {isDrop ? 'Notes (optional)' : isHire ? 'Internal note (optional)' : 'Note'}
            </label>
            <textarea
              id="stage-transition-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                isHire
                  ? 'e.g. starts Mar 1, signed offer letter sent.'
                  : 'Add context for the team reading the candidate timeline.'
              }
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              data-testid="stage-transition-note-input"
            />
          </div>

          {isHire && (
            <p className="text-xs text-slate-500">
              This will be recorded as the hire event in Reports and Activities. You can still
              move the candidate later if needed.
            </p>
          )}
        </div>

        {err && (
          <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700" role="alert">
            {err}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 p-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className={
              'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ' +
              (isDrop ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700')
            }
            data-testid="stage-transition-confirm"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {isDrop ? 'Drop candidate' : isHire ? 'Confirm hire' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  const cls =
    tone === 'success'
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : tone === 'danger'
      ? 'bg-rose-50 text-rose-700 ring-rose-200'
      : 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}
    >
      {children}
    </span>
  );
}
