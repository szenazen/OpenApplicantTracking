'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ChevronRight,
  Download,
  MoreHorizontal,
  PauseCircle,
  PencilLine,
  PlayCircle,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ApplicationCard, JobStatus, JobSummary, Pipeline } from '@/lib/api';

/**
 * 3-dot "More" menu on the job header.
 *
 * Groups two kinds of actions:
 *   1. Destructive / metadata changes that hit the server (status transitions,
 *      edit) — surfaced through callbacks the header wires up.
 *   2. Pure client-side helpers (export candidates to CSV) that don't need
 *      the API because `JobContext` already has the authoritative in-memory
 *      snapshot via `liveApplications`.
 *
 * The menu is an uncontrolled popover anchored to the trigger; it closes on
 * outside click, ESC, or after an action fires. Status items that match the
 * job's current status are disabled to reduce accidental no-op writes.
 */
export function JobActionsMenu({
  job,
  pipeline,
  applications,
  onEdit,
  onStatusChange,
}: {
  job: JobSummary;
  pipeline: Pipeline;
  applications: ApplicationCard[];
  onEdit: () => void;
  onStatusChange: (next: JobStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setStatusOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setStatusOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function handlePick(next: JobStatus) {
    setOpen(false);
    setStatusOpen(false);
    onStatusChange(next);
  }

  function handleExport() {
    setOpen(false);
    exportApplicationsCsv(job, pipeline, applications);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label="Job actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="self-start rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
        data-testid="job-actions-trigger"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg"
          data-testid="job-actions-menu"
        >
          <MenuItem
            icon={PencilLine}
            label="Edit job"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            testId="job-action-edit"
          />

          <div
            className="relative"
            onMouseEnter={() => setStatusOpen(true)}
            onMouseLeave={() => setStatusOpen(false)}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-50"
              onClick={() => setStatusOpen((v) => !v)}
              data-testid="job-action-change-status"
            >
              <span className="inline-flex items-center gap-2">
                <PlayCircle size={14} className="text-slate-500" /> Change status
              </span>
              <ChevronRight size={14} className="text-slate-400" />
            </button>
            {statusOpen && (
              <div
                role="menu"
                className="absolute right-full top-0 mr-1 w-48 rounded-md border border-slate-200 bg-white p-1 shadow-lg"
                data-testid="job-actions-status-submenu"
              >
                <StatusMenuItem
                  current={job.status}
                  value="PUBLISHED"
                  icon={PlayCircle}
                  label="Published"
                  onPick={handlePick}
                />
                <StatusMenuItem
                  current={job.status}
                  value="ON_HOLD"
                  icon={PauseCircle}
                  label="On hold"
                  onPick={handlePick}
                />
                <StatusMenuItem
                  current={job.status}
                  value="CLOSED"
                  icon={XCircle}
                  label="Closed"
                  onPick={handlePick}
                />
                <StatusMenuItem
                  current={job.status}
                  value="ARCHIVED"
                  icon={Archive}
                  label="Archived"
                  onPick={handlePick}
                />
              </div>
            )}
          </div>

          <div className="my-1 h-px bg-slate-100" />

          <MenuItem
            icon={Download}
            label={`Export candidates (${applications.length})`}
            onClick={handleExport}
            disabled={applications.length === 0}
            testId="job-action-export"
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-slate-700 ${
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-slate-50'
      }`}
      data-testid={testId}
    >
      <Icon size={14} className="text-slate-500" />
      {label}
    </button>
  );
}

function StatusMenuItem({
  current,
  value,
  icon: Icon,
  label,
  onPick,
}: {
  current: string;
  value: JobStatus;
  icon: LucideIcon;
  label: string;
  onPick: (s: JobStatus) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={active}
      onClick={() => onPick(value)}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-slate-700 ${
        active ? 'cursor-default bg-slate-100 font-medium' : 'hover:bg-slate-50'
      }`}
      data-testid={`job-action-status-${value}`}
    >
      <Icon size={14} className="text-slate-500" />
      {label}
      {active && <span className="ml-auto text-[10px] uppercase text-slate-400">current</span>}
    </button>
  );
}

/**
 * Build a CSV from the in-memory Kanban snapshot so recruiters can take
 * their shortlist offline without a dedicated export endpoint. Kept
 * client-side because the user already paid for the full list; we just
 * reshape it.
 */
function exportApplicationsCsv(
  job: JobSummary,
  pipeline: Pipeline,
  applications: ApplicationCard[],
) {
  const stageById = new Map(pipeline.statuses.map((s) => [s.id, s.name] as const));
  const header = [
    'Candidate',
    'Headline',
    'Current title',
    'Current company',
    'Location',
    'Years of experience',
    'Stage',
    'Applied at',
    'Last transition at',
    'Comments',
    'Thumbs up',
    'Thumbs down',
    'Stars',
  ];
  const rows = applications.map((a) => [
    `${a.candidate.firstName} ${a.candidate.lastName}`,
    a.candidate.headline ?? '',
    a.candidate.currentTitle ?? '',
    a.candidate.currentCompany ?? '',
    a.candidate.location ?? '',
    a.candidate.yearsExperience == null ? '' : String(a.candidate.yearsExperience),
    stageById.get(a.currentStatusId) ?? '',
    a.appliedAt ?? '',
    a.lastTransitionAt ?? '',
    String(a.commentCount ?? 0),
    String(a.reactionSummary?.counts.THUMBS_UP ?? 0),
    String(a.reactionSummary?.counts.THUMBS_DOWN ?? 0),
    String(a.reactionSummary?.counts.STAR ?? 0),
  ]);
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(job.title)}-candidates-${todayStamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvCell(v: string): string {
  if (v === '') return '';
  // RFC 4180: escape any cell containing commas, quotes, or newlines.
  const needsQuote = /[",\n\r]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'job';
}

function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}${mm}${dd}`;
}
