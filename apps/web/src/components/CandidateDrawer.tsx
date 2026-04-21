'use client';

import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Clock,
  Mail,
  MapPin,
  Phone,
  X,
} from 'lucide-react';
import { api, ApiError, ApplicationDetail } from '@/lib/api';
import { avatarColor, formatRelativeDuration, formatYearsExperience, getInitials } from '@/lib/format';

interface Props {
  /** Application id whose drawer to render. When null/undefined the drawer is closed. */
  applicationId: string | null;
  /** Fired when the drawer should close (Esc, overlay click, X button). */
  onClose: () => void;
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
export function CandidateDrawer({ applicationId, onClose }: Props) {
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
        {detail && <DrawerBody detail={detail} />}
      </aside>
    </div>
  );
}

function DrawerBody({ detail }: { detail: ApplicationDetail }) {
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
