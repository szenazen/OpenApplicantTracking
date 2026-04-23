'use client';

export const dynamic = 'force-dynamic';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  api,
  ApiError,
  AccountMember,
  AssignableInviteRolesResponse,
  InvitationCreated,
  PendingInvitation,
  PipelineWithStatuses,
} from '@/lib/api';
import { useAuth } from '@/lib/store';

export default function AccountSettingsPage() {
  const router = useRouter();
  const { me, activeAccountId } = useAuth();
  const [pipelines, setPipelines] = useState<PipelineWithStatuses[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [invites, setInvites] = useState<PendingInvitation[]>([]);
  const [roles, setRoles] = useState<AssignableInviteRolesResponse['roles']>([]);
  const [err, setErr] = useState<string | null>(null);
  const [newStageName, setNewStageName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const allowedForActive =
    me?.accounts.some(
      (a) => a.id === activeAccountId && (a.role === 'admin' || a.role === 'account_manager'),
    ) ?? false;

  useEffect(() => {
    if (!me || !activeAccountId) return;
    if (!allowedForActive) router.replace('/dashboard');
  }, [me, activeAccountId, allowedForActive, router]);

  useEffect(() => {
    if (!activeAccountId || !allowedForActive) return;
    let cancelled = false;
    setErr(null);
    Promise.all([
      api<PipelineWithStatuses[]>('/pipelines'),
      api<AccountMember[]>('/accounts/current/members'),
      api<PendingInvitation[]>('/invitations'),
      api<AssignableInviteRolesResponse>('/accounts/current/assignable-invite-roles'),
    ])
      .then(([p, m, inv, r]) => {
        if (cancelled) return;
        setPipelines(p);
        setMembers(m);
        setInvites(inv);
        setRoles(r.roles);
        setInviteRole((prev) => prev || r.roles[0]?.name || '');
        setAddRole((prev) => prev || r.roles[0]?.name || '');
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : 'Failed to load settings');
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, allowedForActive]);

  const defaultPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];

  async function refreshPipelines() {
    const p = await api<PipelineWithStatuses[]>('/pipelines');
    setPipelines(p);
  }

  async function addStatus(e: FormEvent) {
    e.preventDefault();
    if (!defaultPipeline || !newStageName.trim()) return;
    setErr(null);
    try {
      await api(`/pipelines/${defaultPipeline.id}/statuses`, {
        body: { name: newStageName.trim() },
      });
      setNewStageName('');
      await refreshPipelines();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to add stage');
    }
  }

  async function removeStatus(statusId: string) {
    if (!defaultPipeline) return;
    if (!confirm('Remove this stage? It must have no candidates.')) return;
    setErr(null);
    try {
      await api(`/pipelines/${defaultPipeline.id}/statuses/${statusId}`, { method: 'DELETE' });
      await refreshPipelines();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to remove');
    }
  }

  async function moveStatus(idx: number, direction: -1 | 1) {
    if (!defaultPipeline) return;
    const sts = [...defaultPipeline.statuses];
    const j = idx + direction;
    if (j < 0 || j >= sts.length) return;
    const tmp = sts[idx]!;
    sts[idx] = sts[j]!;
    sts[j] = tmp;
    setErr(null);
    try {
      await api(`/pipelines/${defaultPipeline.id}/statuses/reorder`, {
        method: 'PUT',
        body: { statusIds: sts.map((s) => s.id) },
      });
      await refreshPipelines();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Reorder failed');
    }
  }

  async function submitInvite(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setInviteLink(null);
    try {
      const res = await api<InvitationCreated>('/invitations', {
        body: { email: inviteEmail.trim(), role: inviteRole },
      });
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setInviteLink(`${origin}/login?invite=${encodeURIComponent(res.token)}`);
      setInviteEmail('');
      setInvites(await api<PendingInvitation[]>('/invitations'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Invite failed');
    }
  }

  async function submitAddMember(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await api('/accounts/current/members', { body: { email: addEmail.trim(), role: addRole } });
      setAddEmail('');
      setMembers(await api<AccountMember[]>('/accounts/current/members'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Add member failed');
    }
  }

  async function revokeInvite(id: string) {
    setErr(null);
    try {
      await api(`/invitations/${id}`, { method: 'DELETE' });
      setInvites(await api<PendingInvitation[]>('/invitations'));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Revoke failed');
    }
  }

  if (!me || !allowedForActive) {
    return (
      <div className="p-6">
        <p className="text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10 p-6">
      <header>
        <Link href="/dashboard" className="text-sm text-brand-700 hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Account settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pipeline stages and team access for the active account (
          {me.accounts.find((a) => a.id === activeAccountId)?.name}). Switch accounts in the header to manage another
          tenant.
        </p>
      </header>

      {err && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {err}
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Hiring pipeline</h2>
        <p className="mt-1 text-sm text-slate-500">
          Stages on the account default pipeline. Removing a stage is only allowed when no candidates are still in it.
        </p>
        {!defaultPipeline ? (
          <p className="mt-4 text-sm text-slate-500">No pipeline found.</p>
        ) : (
          <>
            <ul className="mt-4 space-y-2">
              {defaultPipeline.statuses.map((s, idx) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color ?? '#94a3b8' }}
                      aria-hidden
                    />
                    <span className="text-sm font-medium text-slate-800">{s.name}</span>
                    <span className="text-xs text-slate-400">{s.category}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-white"
                      onClick={() => moveStatus(idx, -1)}
                      disabled={idx === 0}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-white"
                      onClick={() => moveStatus(idx, 1)}
                      disabled={idx === defaultPipeline.statuses.length - 1}
                    >
                      Down
                    </button>
                    <button
                      type="button"
                      className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      onClick={() => removeStatus(s.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <form onSubmit={addStatus} className="mt-4 flex flex-wrap items-end gap-2">
              <label className="block text-sm">
                <span className="text-slate-600">New stage name</span>
                <input
                  value={newStageName}
                  onChange={(e) => setNewStageName(e.target.value)}
                  className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Add stage
              </button>
            </form>
          </>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Team and invitations</h2>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-slate-700">Active members</h3>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {members.map((m) => (
                <li key={m.userId} className="py-2">
                  <span className="font-medium text-slate-800">{m.displayName}</span>
                  <span className="ml-2 text-slate-500">{m.email}</span>
                  <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{m.role}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-medium text-slate-700">Pending invitations</h3>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {invites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    {inv.email} <span className="text-slate-400">({inv.role})</span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-xs text-red-600 hover:underline"
                    onClick={() => revokeInvite(inv.id)}
                  >
                    Revoke
                  </button>
                </li>
              ))}
              {invites.length === 0 && <li className="py-2 text-slate-400">None</li>}
            </ul>
          </div>
        </div>

        <div className="mt-6 grid gap-6 border-t border-slate-100 pt-6 md:grid-cols-2">
          <form onSubmit={submitInvite} className="space-y-2">
            <h3 className="text-sm font-medium text-slate-700">Invite by email</h3>
            <p className="text-xs text-slate-500">
              They must sign in with this email, then open the invite link (or paste the token after login).
            </p>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">
              Create invitation
            </button>
            {inviteLink && (
              <p className="break-all text-xs text-slate-600">
                Share link: <code>{inviteLink}</code>
              </p>
            )}
          </form>

          <form onSubmit={submitAddMember} className="space-y-2">
            <h3 className="text-sm font-medium text-slate-700">Add existing user</h3>
            <p className="text-xs text-slate-500">User must already have an OpenATS account.</p>
            <input
              type="email"
              required
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              placeholder="existing.user@company.com"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Add to account
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
