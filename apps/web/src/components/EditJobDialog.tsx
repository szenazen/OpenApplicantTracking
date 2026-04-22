'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  api,
  ApiError,
  type AccountMember,
  type EmploymentType,
  type JobStatus,
  type JobSummary,
  type SkillRef,
  type UpdateJobInput,
} from '@/lib/api';

interface SkillOption extends SkillRef {}

interface Props {
  job: JobSummary;
  open: boolean;
  onClose: () => void;
  onSaved: (next: JobSummary) => void;
}

const EMPLOYMENT_TYPES: EmploymentType[] = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERNSHIP',
  'TEMPORARY',
];

const JOB_STATUSES: JobStatus[] = ['DRAFT', 'PUBLISHED', 'ON_HOLD', 'CLOSED', 'ARCHIVED'];

/**
 * Modal dialog for editing the core fields of a job in place.
 *
 * Responsibilities / design:
 *   - Seeds its form state from the current `job` every time it opens so
 *     cancel + re-open always starts from the server truth.
 *   - Uses a server-driven skills picker (`GET /skills?q=`) because the
 *     global catalog can be large; we show the currently-selected skills as
 *     chips regardless of whether they're in the current search result so
 *     removing is always possible.
 *   - On save, sends a partial `PATCH /jobs/:id`. Fields that were not
 *     changed from the current job are omitted so we get a clean audit diff.
 *   - Clearing nullable string fields (description / department / location)
 *     sends explicit `null` so the server clears them; empty string is
 *     normalized to null.
 */
export function EditJobDialog({ job, open, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(job.title);
  const [description, setDescription] = useState(job.description ?? '');
  const [department, setDepartment] = useState(job.department ?? '');
  const [location, setLocation] = useState(job.location ?? '');
  const [clientName, setClientName] = useState(job.clientName ?? '');
  const [headCount, setHeadCount] = useState<string>(String(job.headCount ?? 1));
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    (job.employmentType as EmploymentType) ?? 'FULL_TIME',
  );
  const [status, setStatus] = useState<JobStatus>((job.status as JobStatus) ?? 'PUBLISHED');
  const [selectedSkills, setSelectedSkills] = useState<SkillRef[]>(
    job.requiredSkills ?? (job.requiredSkillIds ?? []).map((id) => ({ id, name: id })),
  );
  const [skillQuery, setSkillQuery] = useState('');
  const [skillResults, setSkillResults] = useState<SkillOption[]>([]);
  const [ownerUserId, setOwnerUserId] = useState<string>(job.owner?.id ?? '');
  const [accountMembers, setAccountMembers] = useState<AccountMember[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(job.title);
    setDescription(job.description ?? '');
    setDepartment(job.department ?? '');
    setLocation(job.location ?? '');
    setClientName(job.clientName ?? '');
    setHeadCount(String(job.headCount ?? 1));
    setEmploymentType((job.employmentType as EmploymentType) ?? 'FULL_TIME');
    setStatus((job.status as JobStatus) ?? 'PUBLISHED');
    setSelectedSkills(job.requiredSkills ?? (job.requiredSkillIds ?? []).map((id) => ({ id, name: id })));
    setSkillQuery('');
    setSkillResults([]);
    setOwnerUserId(job.owner?.id ?? '');
    setAccountMembers(null);
    setErr(null);
  }, [open, job]);

  useEffect(() => {
    if (!open) return;
    api<AccountMember[]>('/accounts/current/members')
      .then(setAccountMembers)
      .catch(() => setAccountMembers([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  useEffect(() => {
    if (!open) return;
    const q = skillQuery.trim();
    if (q.length === 0) {
      setSkillResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api<SkillOption[]>(`/skills?q=${encodeURIComponent(q)}`)
        .then((rows) => {
          if (!cancelled) setSkillResults(rows);
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [skillQuery, open]);

  const selectedIds = useMemo(() => new Set(selectedSkills.map((s) => s.id)), [selectedSkills]);

  if (!open) return null;

  function addSkill(s: SkillRef) {
    if (selectedIds.has(s.id)) return;
    setSelectedSkills((cur) => [...cur, s]);
  }
  function removeSkill(id: string) {
    setSelectedSkills((cur) => cur.filter((s) => s.id !== id));
  }

  function computePatch(): UpdateJobInput {
    const patch: UpdateJobInput = {};
    const trimmedTitle = title.trim();
    if (trimmedTitle !== job.title) patch.title = trimmedTitle;

    const nextDesc = description.trim() === '' ? null : description;
    const curDesc = job.description ?? null;
    if (nextDesc !== curDesc) patch.description = nextDesc;

    const nextDept = department.trim() === '' ? null : department.trim();
    const curDept = job.department ?? null;
    if (nextDept !== curDept) patch.department = nextDept;

    const nextLoc = location.trim() === '' ? null : location.trim();
    const curLoc = job.location ?? null;
    if (nextLoc !== curLoc) patch.location = nextLoc;

    const nextClient = clientName.trim() === '' ? null : clientName.trim();
    const curClient = job.clientName ?? null;
    if (nextClient !== curClient) patch.clientName = nextClient;

    // `headCount` is always a positive integer; skip the patch if the input
    // is empty/invalid so the no-op return below short-circuits cleanly.
    const parsedHead = Number.parseInt(headCount, 10);
    if (Number.isInteger(parsedHead) && parsedHead >= 1 && parsedHead !== (job.headCount ?? 1)) {
      patch.headCount = parsedHead;
    }

    if (employmentType !== job.employmentType) patch.employmentType = employmentType;
    if (status !== job.status) patch.status = status;

    const currentIds = new Set(job.requiredSkillIds ?? []);
    const nextIds = selectedSkills.map((s) => s.id);
    const nextSet = new Set(nextIds);
    const sameSet =
      currentIds.size === nextSet.size && [...currentIds].every((id) => nextSet.has(id));
    if (!sameSet) patch.requiredSkillIds = nextIds;

    const curOwnerId = job.owner?.id ?? '';
    if (ownerUserId !== curOwnerId) {
      patch.ownerId = ownerUserId === '' ? null : ownerUserId;
    }
    return patch;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (title.trim() === '') {
      setErr('Title is required');
      return;
    }
    const patch = computePatch();
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const updated = await api<JobSummary>(`/jobs/${job.id}`, { method: 'PATCH', body: patch });
      // Preserve the locally-known resolved skills so the header / summary
      // re-render immediately without a second round-trip for /jobs/:id.
      onSaved({
        ...updated,
        requiredSkills: selectedSkills,
        owner: updated.owner ?? null,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-job-title"
      data-testid="edit-job-dialog"
    >
      <form
        onSubmit={onSubmit}
        className="my-8 w-full max-w-2xl rounded-lg bg-white shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div>
            <h2 id="edit-job-title" className="text-base font-semibold text-slate-900">
              Edit job
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Update the job details and required skills. Changes show up in the Activities tab.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Title" required className="sm:col-span-2">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              data-testid="edit-job-title-input"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>

          <Field label="Owner (recruiter)">
            <select
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
              disabled={!accountMembers}
              data-testid="edit-job-owner"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50"
            >
              <option value="">Unassigned</option>
              {(accountMembers ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName || m.email}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Department">
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              data-testid="edit-job-department-input"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>

          <Field label="Location">
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              data-testid="edit-job-location-input"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>

          <Field label="Client">
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Amazon"
              data-testid="edit-job-client-input"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>

          <Field label="Head count">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={10_000}
              step={1}
              value={headCount}
              onChange={(e) => setHeadCount(e.target.value)}
              data-testid="edit-job-headcount-input"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>

          <Field label="Employment type">
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
              data-testid="edit-job-employment-type"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.toLowerCase().replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as JobStatus)}
              data-testid="edit-job-status"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {JOB_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase().replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Description" className="sm:col-span-2">
            <textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="edit-job-description-input"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>

          <Field label="Required skills" className="sm:col-span-2">
            <div
              className="flex flex-wrap items-center gap-1.5 rounded border border-slate-300 p-2"
              data-testid="edit-job-skills"
            >
              {selectedSkills.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200"
                >
                  {s.name}
                  <button
                    type="button"
                    onClick={() => removeSkill(s.id)}
                    aria-label={`Remove ${s.name}`}
                    className="text-brand-600 hover:text-brand-900"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={skillQuery}
                onChange={(e) => setSkillQuery(e.target.value)}
                placeholder={selectedSkills.length ? 'Add more…' : 'Type to search skills'}
                className="min-w-[140px] flex-1 border-none bg-transparent text-sm outline-none"
                data-testid="edit-job-skill-search"
              />
            </div>
            {skillResults.length > 0 && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded border border-slate-200 bg-white shadow-sm">
                {skillResults
                  .filter((r) => !selectedIds.has(r.id))
                  .slice(0, 20)
                  .map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        addSkill(r);
                        setSkillQuery('');
                        setSkillResults([]);
                      }}
                      className="flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                    >
                      <span>{r.name}</span>
                      <span className="text-[10px] text-slate-400">add</span>
                    </button>
                  ))}
              </div>
            )}
          </Field>
        </div>

        {err && (
          <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700" role="alert">
            {err}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 p-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || title.trim() === ''}
            className="inline-flex items-center gap-1.5 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            data-testid="edit-job-save"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-xs font-medium text-slate-700 ${className ?? ''}`}>
      <span className="mb-1 block">
        {label}
        {required && <span className="ml-0.5 text-rose-600">*</span>}
      </span>
      {children}
    </label>
  );
}
