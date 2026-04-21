'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import {
  api,
  ApiError,
  type AccountMember,
  type JobMember,
  type JobMemberRole,
} from '@/lib/api';
import { useJob } from '../JobContext';

const ROLE_OPTIONS: { value: JobMemberRole; label: string }[] = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'RECRUITER', label: 'Recruiter' },
  { value: 'HIRING_MANAGER', label: 'Hiring manager' },
  { value: 'INTERVIEWER', label: 'Interviewer' },
  { value: 'OBSERVER', label: 'Observer' },
];

/**
 * "Team" tab — add / remove / retitle the humans who collaborate on this job.
 *
 * Design notes:
 *   - The picker only offers *active* account members. Inviting a brand-new
 *     user happens at account level (separate feature); we never escalate
 *     scope by adding a stranger here.
 *   - The team list is sourced from `JobContext` so changes made here also
 *     update the header avatar chips immediately, without refetching.
 *   - Role is a UI-level concept enforced server-side via an enum; the API
 *     rejects anything outside the known values.
 */
export default function JobTeamPage() {
  const { job, members, setMembers } = useJob();
  const [accountMembers, setAccountMembers] = useState<AccountMember[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerUserId, setPickerUserId] = useState('');
  const [pickerRole, setPickerRole] = useState<JobMemberRole>('RECRUITER');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await api<JobMember[]>(`/jobs/${job.id}/members`);
      setMembers(list);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to load team');
    }
  }, [job.id, setMembers]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pickerOpen) return;
    api<AccountMember[]>('/accounts/current/members')
      .then(setAccountMembers)
      .catch((e) => setErr(e?.message ?? 'Failed to load account members'));
  }, [pickerOpen]);

  /** Account members not yet on the job — the only ones the picker should offer. */
  const addable = useMemo(() => {
    if (!accountMembers) return [];
    const onJob = new Set(members.map((m) => m.userId));
    return accountMembers.filter((m) => !onJob.has(m.userId));
  }, [accountMembers, members]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!pickerUserId || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const created = await api<JobMember>(`/jobs/${job.id}/members`, {
        method: 'POST',
        body: { userId: pickerUserId, role: pickerRole },
      });
      setMembers([...members, created]);
      setPickerOpen(false);
      setPickerUserId('');
      setPickerRole('RECRUITER');
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message);
      else setErr((e as Error).message ?? 'Failed to add member');
    } finally {
      setSaving(false);
    }
  }

  async function onChangeRole(m: JobMember, role: JobMemberRole) {
    try {
      const updated = await api<JobMember>(`/job-members/${m.id}`, {
        method: 'PATCH',
        body: { role },
      });
      setMembers(members.map((x) => (x.id === m.id ? updated : x)));
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to update role');
    }
  }

  async function onRemove(m: JobMember) {
    if (!confirm(`Remove ${m.user?.displayName ?? m.user?.email ?? 'this member'} from the team?`)) return;
    try {
      await api(`/job-members/${m.id}`, { method: 'DELETE' });
      setMembers(members.filter((x) => x.id !== m.id));
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to remove member');
    }
  }

  return (
    <div className="overflow-auto p-6" data-testid="job-team-page">
      <div className="max-w-3xl space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Team</h2>
            <p className="text-xs text-slate-500">
              The humans collaborating on this requisition. Account members only — invite new users at the account
              level first.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
            data-testid="team-add-toggle"
          >
            <UserPlus size={14} /> Add member
          </button>
        </header>

        {err && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            {err}
          </p>
        )}

        {pickerOpen && (
          <form
            onSubmit={onAdd}
            className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_180px_auto]"
            data-testid="team-add-form"
          >
            <label className="flex flex-col text-xs text-slate-600">
              Account member
              <select
                value={pickerUserId}
                onChange={(e) => setPickerUserId(e.target.value)}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                data-testid="team-add-user"
                required
              >
                <option value="">Select…</option>
                {addable.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {(m.displayName ?? m.email) + (m.displayName ? ` (${m.email})` : '')}
                  </option>
                ))}
              </select>
              {accountMembers && addable.length === 0 && (
                <span className="mt-1 text-[11px] text-slate-400">
                  Every active account member is already on this job.
                </span>
              )}
            </label>

            <label className="flex flex-col text-xs text-slate-600">
              Role
              <select
                value={pickerRole}
                onChange={(e) => setPickerRole(e.target.value as JobMemberRole)}
                className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                data-testid="team-add-role"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={!pickerUserId || saving}
                className="inline-flex items-center rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                data-testid="team-add-submit"
              >
                {saving ? 'Adding…' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            On this job ({members.length})
          </h3>
          {members.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
              No team members yet. Add a recruiter or hiring manager to start collaborating.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="team-list">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 p-3" data-testid="team-member">
                  <MemberAvatar member={m} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800" data-testid="team-member-name">
                      {m.user?.displayName ?? m.user?.email ?? 'Unknown'}
                    </p>
                    {m.user?.email && (
                      <p className="truncate text-[11px] text-slate-500">{m.user.email}</p>
                    )}
                  </div>
                  <select
                    value={m.role}
                    onChange={(e) => onChangeRole(m, e.target.value as JobMemberRole)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    data-testid="team-member-role"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onRemove(m)}
                    className="rounded p-1 text-rose-500 hover:bg-rose-50"
                    aria-label="Remove"
                    data-testid="team-member-remove"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function MemberAvatar({ member }: { member: JobMember }) {
  const name = member.user?.displayName ?? member.user?.email ?? '?';
  const initials = name
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  if (member.user?.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.user.avatarUrl} alt={name} className="h-9 w-9 rounded-full object-cover" />;
  }
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
      {initials || '?'}
    </span>
  );
}
