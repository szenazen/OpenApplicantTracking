'use client';

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TransitionEvent,
} from 'react';
import clsx from 'clsx';
import {
  ArrowRight,
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  Clipboard,
  ClipboardCheck,
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
  ApplicationCard,
  ApplicationComment,
  ApplicationDetail,
  CandidateProfileDetail,
  Pipeline,
  PipelineStatus,
  ReactionKind,
  ReactionSummary,
} from '@/lib/api';
import { useAuth } from '@/lib/store';
import { avatarColor, formatRelativeDuration, formatYearsExperience, getInitials } from '@/lib/format';
import {
  PendingTransition,
  StageTransitionDialog,
} from './StageTransitionDialog';

/**
 * Patch surfaced to the host page whenever the drawer mutates server state
 * (comments, reactions, stage move, candidate edits). Host merges the patch
 * into the Kanban card overrides so badges / column placement stay in sync
 * without a full refetch.
 */
interface ActivityPatch {
  commentCount?: number;
  reactionSummary?: ReactionSummary;
  /** Partial fields that should also be reflected on the Kanban card. */
  card?: Partial<ApplicationCard>;
}

interface Props {
  /** Application id whose drawer to render. When null/undefined the drawer is closed. */
  applicationId: string | null;
  /**
   * When set (and `applicationId` is null), loads `GET /candidates/:id` — e.g.
   * Recommendations before the candidate is on the job.
   */
  previewCandidateId?: string | null;
  /** Current job title for the preview banner (optional). */
  previewJobTitle?: string | null;
  /** Primary CTA in preview mode (e.g. “Add to job”). */
  previewPrimaryAction?: {
    label: string;
    disabled?: boolean;
    onClick: () => void | Promise<void>;
  } | null;
  /** Fired when the drawer should close (Esc, overlay click, X button). */
  onClose: () => void;
  /**
   * Optional pipeline so the drawer can render a stage-control dropdown.
   * When omitted the drawer stays read-only on status (useful for pages
   * without a pipeline context, e.g. the candidates list).
   */
  pipeline?: Pipeline;
  /**
   * Emitted whenever the drawer mutates server-side activity (posting a
   * comment, toggling a reaction, editing candidate fields, moving the
   * card) so the parent page can feed the new values into the Kanban card
   * badges / columns without a full refetch.
   */
  onActivityChange?: (applicationId: string, patch: ActivityPatch) => void;
}

function mapProfileToDrawerCandidate(c: CandidateProfileDetail): ApplicationDetail['candidate'] {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email ?? null,
    phone: c.phone ?? null,
    headline: c.headline ?? null,
    location: c.location ?? null,
    currentCompany: c.currentCompany ?? null,
    currentTitle: c.currentTitle ?? null,
    yearsExperience: c.yearsExperience ?? null,
    summary: c.summary ?? null,
    source: c.source ?? null,
    skills: c.skills.map((s) => ({
      skillId: s.skillId,
      name: s.skill.name,
      category: s.skill.category,
      slug: s.skill.slug,
      level: s.level,
    })),
  };
}

/**
 * Right-hand drawer that shows a candidate's full profile for the currently
 * selected application. Data comes from `GET /applications/:id` so we get:
 *   - canonical candidate fields                    (CANDIDATES table in design)
 *   - current job + current pipeline status         (APPLICATIONS + PIPELINE_STATUSES)
 *   - full status-change timeline                   (APPLICATION_STATUS_HISTORY)
 *
 * Interactive surfaces, in addition to the read-only profile:
 *   - Stage control           → PATCH /applications/:id/move (with reason modal
 *                               for HIRED/DROPPED transitions).
 *   - Inline candidate edit   → PATCH /candidates/:id (name, contact, headline,
 *                               title/company/location, yoe, summary).
 *   - Quick actions           → copy email / phone to clipboard for fast
 *                               outreach without leaving the drawer.
 */
export function CandidateDrawer({
  applicationId,
  previewCandidateId = null,
  previewJobTitle = null,
  previewPrimaryAction = null,
  onClose,
  pipeline,
  onActivityChange,
}: Props) {
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [previewCandidate, setPreviewCandidate] = useState<ApplicationDetail['candidate'] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((v) => v + 1), []);

  const drawerOpen = Boolean(applicationId) || Boolean(previewCandidateId);

  /** Slide-in / slide-out chrome (panel stays mounted while closing animation runs). */
  const [slideIn, setSlideIn] = useState(false);
  const [slideOut, setSlideOut] = useState(false);
  const closingRef = useRef(false);

  useEffect(() => {
    if (!drawerOpen) {
      closingRef.current = false;
      setSlideIn(false);
      setSlideOut(false);
      return;
    }
    closingRef.current = false;
    setSlideOut(false);
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setSlideIn(true);
      return;
    }
    setSlideIn(false);
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => setSlideIn(true));
    });
    return () => cancelAnimationFrame(id);
  }, [drawerOpen, applicationId, previewCandidateId]);

  const requestClose = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      closingRef.current = false;
      onClose();
      return;
    }
    closingRef.current = true;
    setSlideOut(true);
    setSlideIn(false);
  }, [onClose]);

  const onAsideTransitionEnd = useCallback(
    (e: TransitionEvent<HTMLAsideElement>) => {
      if (e.propertyName !== 'transform') return;
      if (closingRef.current) {
        closingRef.current = false;
        onClose();
        setSlideOut(false);
      }
    },
    [onClose],
  );

  // Fetch whenever the selected application changes, or an explicit
  // refresh is requested (e.g. after a 409 reconcile).
  useEffect(() => {
    if (!applicationId) {
      setDetail(null);
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
  }, [applicationId, refreshToken]);

  useEffect(() => {
    if (!previewCandidateId || applicationId) {
      setPreviewCandidate(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<CandidateProfileDetail>(`/candidates/${previewCandidateId}`)
      .then((c) => {
        if (cancelled) return;
        setPreviewCandidate(mapProfileToDrawerCandidate(c));
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
  }, [previewCandidateId, applicationId, refreshToken]);

  // Close on Escape when open.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, requestClose]);

  if (!drawerOpen) return null;

  const panelOpen = slideIn && !slideOut;

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
        className={clsx(
          'flex-1 bg-slate-900/30 transition-opacity duration-300 ease-out motion-reduce:transition-none',
          panelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
        data-testid="drawer-overlay"
        onClick={requestClose}
      />
      <aside
        className={clsx(
          'flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl transition-transform duration-300 ease-out motion-reduce:transition-none',
          panelOpen ? 'translate-x-0' : 'translate-x-full',
        )}
        onTransitionEnd={onAsideTransitionEnd}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-700">Candidate</h2>
          <button
            type="button"
            aria-label="Close"
            data-testid="drawer-close"
            onClick={requestClose}
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
        {applicationId && detail && (
          <DrawerBody
            detail={detail}
            pipeline={pipeline}
            onActivityChange={onActivityChange}
            onLocalCandidateUpdate={(patch) =>
              setDetail((prev) =>
                prev ? { ...prev, candidate: { ...prev.candidate, ...patch } } : prev,
              )
            }
            onRefresh={refresh}
          />
        )}
        {previewCandidateId && previewCandidate && !applicationId && (
          <PreviewDrawerBody
            candidate={previewCandidate}
            jobTitle={previewJobTitle ?? null}
            primaryAction={previewPrimaryAction ?? null}
            onCandidateUpdated={(patch) =>
              setPreviewCandidate((prev) => (prev ? { ...prev, ...patch } : prev))
            }
          />
        )}
      </aside>
    </div>
  );
}

function PreviewDrawerBody({
  candidate,
  jobTitle,
  primaryAction,
  onCandidateUpdated,
}: {
  candidate: ApplicationDetail['candidate'];
  jobTitle: string | null;
  primaryAction: Props['previewPrimaryAction'];
  onCandidateUpdated: (patch: Partial<ApplicationDetail['candidate']>) => void;
}) {
  return (
    <div className="flex flex-col gap-5 p-4">
      <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
        Preview — not on <span className="font-medium">{jobTitle ?? 'this job'}</span> yet. Add them
        below or from the list.
      </p>
      <IdentitySection
        candidate={candidate}
        onSaved={(patch) => {
          onCandidateUpdated(patch);
        }}
      />
      <ContactSection candidate={candidate} />
      <DrawerSkills skills={candidate.skills} />
      {primaryAction && (
        <button
          type="button"
          disabled={primaryAction.disabled}
          onClick={() => void primaryAction.onClick()}
          className="inline-flex items-center justify-center gap-1 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          data-testid="drawer-preview-primary"
        >
          {primaryAction.label}
        </button>
      )}
    </div>
  );
}

function DrawerSkills({
  skills,
}: {
  skills: ApplicationDetail['candidate']['skills'] | undefined;
}) {
  if (!skills?.length) return null;
  return (
    <section data-testid="drawer-skills">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Skills
      </h4>
      <ul className="flex flex-wrap gap-1.5">
        {skills.map((s) => (
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
  );
}

function DrawerBody({
  detail,
  pipeline,
  onActivityChange,
  onLocalCandidateUpdate,
  onRefresh,
}: {
  detail: ApplicationDetail;
  pipeline?: Pipeline;
  onActivityChange?: (applicationId: string, patch: ActivityPatch) => void;
  onLocalCandidateUpdate: (patch: Partial<ApplicationDetail['candidate']>) => void;
  onRefresh: () => void;
}) {
  const { candidate, job, currentStatus, transitions } = detail;

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* Identity + inline edit */}
      <IdentitySection
        candidate={candidate}
        onSaved={(patch) => {
          onLocalCandidateUpdate(patch);
          // Mirror display-relevant fields onto the Kanban card so the
          // board badge stays in sync without a refetch.
          onActivityChange?.(detail.id, {
            card: {
              candidate: {
                id: candidate.id,
                firstName: patch.firstName ?? candidate.firstName,
                lastName: patch.lastName ?? candidate.lastName,
                headline: patch.headline ?? candidate.headline ?? null,
                currentTitle: patch.currentTitle ?? candidate.currentTitle ?? null,
                currentCompany: patch.currentCompany ?? candidate.currentCompany ?? null,
                yearsExperience: patch.yearsExperience ?? candidate.yearsExperience ?? null,
                location: patch.location ?? candidate.location ?? null,
              },
            },
          });
        }}
      />

      {/* Contact with quick actions */}
      <ContactSection candidate={candidate} />

      {/* Current application context + stage control */}
      <section className="rounded-md border border-slate-200 p-3" data-testid="drawer-application">
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
        {pipeline && (
          <StageControl
            applicationId={detail.id}
            version={detail.version}
            pipeline={pipeline}
            current={currentStatus}
            candidate={candidate}
            onMoved={(moved) => {
              // Update the drawer's local state so the badge + timeline
              // reflect the new stage immediately; the server websocket
              // event will reconcile the Kanban columns in parallel.
              onActivityChange?.(detail.id, {
                card: {
                  currentStatusId: moved.toStatusId,
                  position: moved.toPosition,
                  version: moved.version,
                },
              });
              onRefresh();
            }}
          />
        )}
      </section>

      {/* Summary */}
      <SummarySection
        candidate={candidate}
        onSaved={(summary) => onLocalCandidateUpdate({ summary })}
      />

      <DrawerSkills skills={candidate.skills} />

      {/* Reactions bar + comments — HR + hiring manager collaboration. */}
      <ReactionsBar
        applicationId={detail.id}
        initial={detail.reactionSummary}
        onChange={(summary) =>
          onActivityChange?.(detail.id, { reactionSummary: summary })
        }
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
 * Identity card (avatar + name + headline + job context chips) with an
 * inline edit form that persists via `PATCH /candidates/:id`.
 */
function IdentitySection({
  candidate,
  onSaved,
}: {
  candidate: ApplicationDetail['candidate'];
  onSaved: (patch: Partial<ApplicationDetail['candidate']>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const initials = getInitials(candidate.firstName, candidate.lastName);
  const palette = avatarColor(candidate.id);
  const yoe = formatYearsExperience(candidate.yearsExperience);

  if (editing) {
    return (
      <CandidateEditForm
        candidate={candidate}
        onCancel={() => setEditing(false)}
        onSaved={(patch) => {
          onSaved(patch);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <section className="flex items-start gap-3" data-testid="drawer-identity">
      <div
        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-base font-semibold ${palette.bg} ${palette.fg}`}
        aria-hidden
      >
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3
            className="truncate text-base font-semibold text-slate-900"
            data-testid="drawer-candidate-name"
          >
            {candidate.firstName} {candidate.lastName}
          </h3>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
            data-testid="drawer-identity-edit"
            aria-label="Edit candidate"
          >
            <Pencil size={10} /> Edit
          </button>
        </div>
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
  );
}

/**
 * Inline form that edits the scalar candidate fields. `summary` lives in
 * its own section so it can be a larger textarea; we keep this form
 * focused on the identity header so the drawer doesn't turn into one
 * giant form.
 */
function CandidateEditForm({
  candidate,
  onCancel,
  onSaved,
}: {
  candidate: ApplicationDetail['candidate'];
  onCancel: () => void;
  onSaved: (patch: Partial<ApplicationDetail['candidate']>) => void;
}) {
  const [firstName, setFirstName] = useState(candidate.firstName);
  const [lastName, setLastName] = useState(candidate.lastName);
  const [email, setEmail] = useState(candidate.email ?? '');
  const [phone, setPhone] = useState(candidate.phone ?? '');
  const [headline, setHeadline] = useState(candidate.headline ?? '');
  const [currentTitle, setCurrentTitle] = useState(candidate.currentTitle ?? '');
  const [currentCompany, setCurrentCompany] = useState(candidate.currentCompany ?? '');
  const [location, setLocation] = useState(candidate.location ?? '');
  const [yearsExperienceText, setYearsExperienceText] = useState(
    candidate.yearsExperience == null ? '' : String(candidate.yearsExperience),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!firstName.trim() || !lastName.trim()) {
      setErr('First and last name are required.');
      return;
    }
    setSaving(true);
    setErr(null);
    const body = diffInput(
      {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: normalizeOptional(email),
        phone: normalizeOptional(phone),
        headline: normalizeOptional(headline),
        currentTitle: normalizeOptional(currentTitle),
        currentCompany: normalizeOptional(currentCompany),
        location: normalizeOptional(location),
        yearsExperience: yearsExperienceText.trim() === ''
          ? candidate.yearsExperience == null
            ? undefined
            : null
          : Math.max(0, Math.round(Number(yearsExperienceText))),
      },
      candidate,
    );
    if (Object.keys(body).length === 0) {
      setSaving(false);
      onCancel();
      return;
    }
    try {
      const updated = await api<ApplicationDetail['candidate']>(`/candidates/${candidate.id}`, {
        method: 'PATCH',
        body,
      });
      onSaved({
        firstName: updated.firstName,
        lastName: updated.lastName,
        email: updated.email ?? null,
        phone: updated.phone ?? null,
        headline: updated.headline ?? null,
        currentTitle: updated.currentTitle ?? null,
        currentCompany: updated.currentCompany ?? null,
        location: updated.location ?? null,
        yearsExperience: updated.yearsExperience ?? null,
      });
    } catch (e) {
      setErr((e as Error).message ?? 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-2"
      data-testid="drawer-identity-form"
    >
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="First name"
          value={firstName}
          onChange={setFirstName}
          required
          testId="edit-firstName"
        />
        <TextField
          label="Last name"
          value={lastName}
          onChange={setLastName}
          required
          testId="edit-lastName"
        />
      </div>
      <TextField
        label="Headline"
        value={headline}
        onChange={setHeadline}
        placeholder="e.g. Staff Platform Engineer"
        testId="edit-headline"
      />
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Title"
          value={currentTitle}
          onChange={setCurrentTitle}
          testId="edit-currentTitle"
        />
        <TextField
          label="Company"
          value={currentCompany}
          onChange={setCurrentCompany}
          testId="edit-currentCompany"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Location"
          value={location}
          onChange={setLocation}
          testId="edit-location"
        />
        <TextField
          label="Years of experience"
          value={yearsExperienceText}
          onChange={setYearsExperienceText}
          placeholder="e.g. 8"
          inputMode="numeric"
          testId="edit-yearsExperience"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Email"
          value={email}
          onChange={setEmail}
          type="email"
          testId="edit-email"
        />
        <TextField
          label="Phone"
          value={phone}
          onChange={setPhone}
          type="tel"
          testId="edit-phone"
        />
      </div>
      {err && (
        <p role="alert" className="rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">
          {err}
        </p>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
          data-testid="drawer-identity-save"
        >
          <Check size={10} />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  inputMode,
  type,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  inputMode?: 'numeric';
  type?: 'text' | 'email' | 'tel';
  testId?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-600">
      <span>
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </span>
      <input
        type={type ?? 'text'}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        data-testid={testId}
      />
    </label>
  );
}

/** Normalise a text input: empty string → `null` so the server clears the column. */
function normalizeOptional(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Build a PATCH body that only contains fields which actually differ from
 * the current candidate. Missing keys mean "don't touch". Values that are
 * unchanged are dropped entirely so we don't send no-op writes (important
 * for audit cleanliness).
 */
function diffInput(
  next: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    headline: string | null;
    currentTitle: string | null;
    currentCompany: string | null;
    location: string | null;
    yearsExperience: number | null | undefined;
  },
  current: ApplicationDetail['candidate'],
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const pushIfChanged = <K extends keyof typeof next>(key: K, curVal: unknown) => {
    const nextVal = next[key];
    // `undefined` means the caller doesn't want to patch this field.
    if (nextVal === undefined) return;
    const normCur = curVal ?? null;
    if (normCur === nextVal) return;
    body[key as string] = nextVal;
  };
  pushIfChanged('firstName', current.firstName);
  pushIfChanged('lastName', current.lastName);
  pushIfChanged('email', current.email ?? null);
  pushIfChanged('phone', current.phone ?? null);
  pushIfChanged('headline', current.headline ?? null);
  pushIfChanged('currentTitle', current.currentTitle ?? null);
  pushIfChanged('currentCompany', current.currentCompany ?? null);
  pushIfChanged('location', current.location ?? null);
  pushIfChanged('yearsExperience', current.yearsExperience ?? null);
  return body;
}

/** Contact card with clipboard quick actions for email + phone. */
function ContactSection({ candidate }: { candidate: ApplicationDetail['candidate'] }) {
  if (!candidate.email && !candidate.phone) return null;
  return (
    <section className="rounded-md border border-slate-200 p-3" data-testid="drawer-contact">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Contact</h4>
      <ul className="flex flex-col gap-1.5 text-sm text-slate-700">
        {candidate.email && (
          <li className="flex items-center gap-2">
            <Mail size={14} className="text-slate-400" />
            <a
              href={`mailto:${candidate.email}`}
              className="flex-1 truncate hover:underline"
              data-testid="drawer-email-link"
            >
              {candidate.email}
            </a>
            <CopyButton value={candidate.email} label="Copy email" testId="drawer-copy-email" />
          </li>
        )}
        {candidate.phone && (
          <li className="flex items-center gap-2">
            <Phone size={14} className="text-slate-400" />
            <a
              href={`tel:${candidate.phone}`}
              className="flex-1 truncate hover:underline"
              data-testid="drawer-phone-link"
            >
              {candidate.phone}
            </a>
            <CopyButton value={candidate.phone} label="Copy phone" testId="drawer-copy-phone" />
          </li>
        )}
      </ul>
    </section>
  );
}

function CopyButton({ value, label, testId }: { value: string; label: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  async function onClick() {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback for older browsers or insecure contexts where the
        // Clipboard API isn't available.
        const ta = document.createElement('textarea');
        ta.value = value;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Swallow — UI will not flash "Copied" and the user can retry.
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
      data-testid={testId}
    >
      {copied ? <ClipboardCheck size={10} /> : <Clipboard size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** Summary block with inline edit — the textarea is the only heavy input so it gets its own UI. */
function SummarySection({
  candidate,
  onSaved,
}: {
  candidate: ApplicationDetail['candidate'];
  onSaved: (summary: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(candidate.summary ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDraft(candidate.summary ?? '');
  }, [candidate.summary]);

  if (!editing && !candidate.summary) {
    return (
      <section data-testid="drawer-summary-empty">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Summary
          </h4>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
            data-testid="drawer-summary-add"
          >
            <Pencil size={10} /> Add summary
          </button>
        </div>
      </section>
    );
  }

  if (editing) {
    return (
      <section data-testid="drawer-summary-edit">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Summary</h4>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          maxLength={5000}
          placeholder="Add context for the hiring team…"
          className="block w-full resize-y rounded-md border border-slate-300 px-2.5 py-1.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          data-testid="drawer-summary-textarea"
        />
        {err && (
          <p role="alert" className="mt-1 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">
            {err}
          </p>
        )}
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(candidate.summary ?? '');
              setEditing(false);
            }}
            disabled={saving}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              if (saving) return;
              const next = draft.trim();
              const target = next === '' ? null : next;
              const current = candidate.summary ?? null;
              if (target === current) {
                setEditing(false);
                return;
              }
              setSaving(true);
              setErr(null);
              try {
                await api<ApplicationDetail['candidate']>(`/candidates/${candidate.id}`, {
                  method: 'PATCH',
                  body: { summary: target },
                });
                onSaved(target);
                setEditing(false);
              } catch (e) {
                setErr((e as Error).message ?? 'Failed to save summary');
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            data-testid="drawer-summary-save"
          >
            <Check size={10} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="drawer-summary">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Summary</h4>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
          data-testid="drawer-summary-edit-btn"
          aria-label="Edit summary"
        >
          <Pencil size={10} /> Edit
        </button>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
        {candidate.summary}
      </p>
    </section>
  );
}

/**
 * Stage control row. Renders the current status plus a dropdown of the
 * other pipeline statuses. Selecting one either directly moves the
 * application (for benign transitions) or opens the shared
 * StageTransitionDialog (for HIRED / DROPPED so the recruiter is forced to
 * provide a reason).
 */
function StageControl({
  applicationId,
  version,
  pipeline,
  current,
  candidate,
  onMoved,
}: {
  applicationId: string;
  version: number;
  pipeline: Pipeline;
  current: PipelineStatus;
  candidate: ApplicationDetail['candidate'];
  onMoved: (result: { toStatusId: string; toPosition: number; version: number }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTransition | null>(null);

  const otherStatuses = useMemo(
    () =>
      pipeline.statuses
        .filter((s) => s.id !== current.id)
        .sort((a, b) => a.position - b.position),
    [pipeline.statuses, current.id],
  );

  const commitMove = useCallback(
    async (toStatus: PipelineStatus, reason: string) => {
      setErr(null);
      setBusy(true);
      try {
        const idempotencyKey =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${applicationId}-${Date.now()}`;
        const res = await api<{ id: string; currentStatusId: string; position: number; version: number }>(
          `/applications/${applicationId}/move`,
          {
            method: 'PATCH',
            body: {
              toStatusId: toStatus.id,
              // Always put at the top of the target column — the recruiter
              // picked this move from the drawer precisely to focus on
              // this candidate, so we keep them at the top where the eye
              // lands first.
              toPosition: 0,
              expectedVersion: version,
              ...(reason ? { reason } : {}),
            },
            headers: { 'Idempotency-Key': idempotencyKey },
          },
        );
        onMoved({ toStatusId: res.currentStatusId, toPosition: res.position, version: res.version });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          setErr('This card was just updated by someone else — reloading…');
        } else {
          setErr((e as Error).message ?? 'Failed to move card');
        }
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [applicationId, onMoved, version],
  );

  function onSelect(targetId: string) {
    const target = pipeline.statuses.find((s) => s.id === targetId);
    if (!target) return;
    // DROPPED and HIRED demand a reason / confirmation dialog.
    if (target.category === 'DROPPED' || target.category === 'HIRED') {
      setPending({
        card: {
          id: applicationId,
          candidateId: candidate.id,
          jobId: '',
          currentStatusId: current.id,
          position: 0,
          candidate: {
            id: candidate.id,
            firstName: candidate.firstName,
            lastName: candidate.lastName,
          },
        },
        fromStatus: current,
        toStatus: target,
        toPosition: 0,
      });
      return;
    }
    void commitMove(target, '');
  }

  return (
    <div className="mt-3" data-testid="drawer-stage-control">
      <label className="block text-[11px] font-medium text-slate-600">Move to stage</label>
      <div className="relative mt-1">
        <select
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            onSelect(v);
            e.target.value = '';
          }}
          disabled={busy}
          defaultValue=""
          className="block w-full appearance-none rounded-md border border-slate-300 bg-white px-2.5 py-1.5 pr-8 text-sm text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
          data-testid="drawer-stage-select"
          aria-label="Move to stage"
        >
          <option value="" disabled>
            {busy ? 'Moving…' : 'Pick a stage…'}
          </option>
          {otherStatuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.category === 'DROPPED' ? ' (requires reason)' : ''}
              {s.category === 'HIRED' ? ' (confirmation)' : ''}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
        />
      </div>
      {err && (
        <p role="alert" className="mt-1 text-xs text-rose-600">
          {err}
        </p>
      )}
      <StageTransitionDialog
        pending={pending}
        onCancel={() => setPending(null)}
        onConfirm={async (reason) => {
          if (!pending) return;
          try {
            await commitMove(pending.toStatus, reason);
            setPending(null);
          } catch {
            // Surface handled in commitMove via setErr.
          }
        }}
      />
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
