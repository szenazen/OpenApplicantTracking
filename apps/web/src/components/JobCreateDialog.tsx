'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  api,
  ApiError,
  type EmploymentType,
  type JobSummary,
} from '@/lib/api';

interface Props {
  onClose: () => void;
  onCreated: (job: JobSummary) => void;
}

const EMPLOYMENT_TYPES: EmploymentType[] = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'INTERNSHIP',
  'TEMPORARY',
];

/**
 * Lightweight "new requisition" dialog for the Jobs table page.
 *
 * Scope:
 *   - captures the minimum fields the jobs table surfaces (title, client,
 *     location, department, head count, employment type),
 *   - POSTs to `/jobs` which stamps the job as PUBLISHED and `openedAt` now,
 *   - returns the created job via `onCreated` so the caller can navigate
 *     straight into the detail shell without a re-fetch.
 *
 * The required-skills picker lives on the Edit dialog — right after create
 * the recruiter typically flips to the detail page to set skills + team.
 */
export function JobCreateDialog({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [department, setDepartment] = useState('');
  const [location, setLocation] = useState('');
  const [headCount, setHeadCount] = useState('1');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('FULL_TIME');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saving, onClose]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const trimmedTitle = title.trim();
    if (trimmedTitle === '') {
      setErr('Title is required');
      return;
    }
    const parsedHead = Number.parseInt(headCount, 10);
    const nextHead = Number.isInteger(parsedHead) && parsedHead >= 1 ? parsedHead : 1;
    setSaving(true);
    try {
      const created = await api<JobSummary>('/jobs', {
        method: 'POST',
        body: {
          title: trimmedTitle,
          clientName: clientName.trim() || undefined,
          department: department.trim() || undefined,
          location: location.trim() || undefined,
          headCount: nextHead,
          employmentType,
        },
      });
      onCreated(created);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to create job');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-job-title"
      data-testid="create-job-dialog"
    >
      <form onSubmit={onSubmit} className="my-8 w-full max-w-xl rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div>
            <h2 id="create-job-title" className="text-base font-semibold text-slate-900">
              New job
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Create a requisition. You can add required skills and team members from the job&apos;s detail page.
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
              autoFocus
              data-testid="create-job-title-input"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Client">
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Amazon"
              data-testid="create-job-client-input"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Department">
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              data-testid="create-job-department-input"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Location">
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              data-testid="create-job-location-input"
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
              data-testid="create-job-headcount-input"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Employment type">
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}
              data-testid="create-job-employment-type"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.toLowerCase().replace(/_/g, ' ')}
                </option>
              ))}
            </select>
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
            data-testid="create-job-save"
          >
            {saving && <Loader2 size={12} className="animate-spin" />}
            Create job
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
