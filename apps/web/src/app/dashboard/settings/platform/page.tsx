'use client';

export const dynamic = 'force-dynamic';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError, PlatformAccountRow } from '@/lib/api';
import { useAuth } from '@/lib/store';

const REGIONS = [
  { value: 'us-east-1', label: 'US East (us-east-1)' },
  { value: 'eu-west-1', label: 'EU West (eu-west-1)' },
  { value: 'ap-southeast-1', label: 'Singapore (ap-southeast-1)' },
  { value: 'ap-northeast-1', label: 'Tokyo (ap-northeast-1)' },
  { value: 'ap-southeast-2', label: 'Sydney (ap-southeast-2)' },
];

export default function PlatformSettingsPage() {
  const router = useRouter();
  const { me } = useAuth();
  const [accounts, setAccounts] = useState<PlatformAccountRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [region, setRegion] = useState(REGIONS[0]!.value);
  const [ownerEmail, setOwnerEmail] = useState('');

  useEffect(() => {
    if (!me) return;
    if (!me.platformAdmin) {
      router.replace('/dashboard');
      return;
    }
    let cancelled = false;
    api<PlatformAccountRow[]>('/platform/accounts', { withAccount: false })
      .then((rows) => {
        if (!cancelled) setAccounts(rows);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : 'Failed to load accounts');
      });
    return () => {
      cancelled = true;
    };
  }, [me, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setOkMsg(null);
    try {
      await api('/platform/accounts', {
        withAccount: false,
        body: {
          name: name.trim(),
          slug: slug.trim().toLowerCase(),
          region,
          ownerEmail: ownerEmail.trim().toLowerCase(),
        },
      });
      setOkMsg(`Created account “${name.trim()}”.`);
      setName('');
      setSlug('');
      setAccounts(await api<PlatformAccountRow[]>('/platform/accounts', { withAccount: false }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Create failed');
    }
  }

  if (!me?.platformAdmin) {
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
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Platform admin</h1>
        <p className="mt-1 text-sm text-slate-500">
          Provision new customer accounts in any configured region. The owner receives an admin membership on that
          account.
        </p>
      </header>

      {err && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {err}
        </p>
      )}
      {okMsg && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
          {okMsg}
        </p>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">New account</h2>
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="text-slate-600">Display name</span>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Slug</span>
            <input
              required
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              pattern="[a-z0-9-]{3,40}"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600">Region</span>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="text-slate-600">Owner email (must already be registered)</span>
            <input
              type="email"
              required
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="demo@openapplicanttracking.local"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="sm:col-span-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Create account
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">All accounts</h2>
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="font-medium text-slate-800">{a.name}</span>
              <span className="text-slate-500">
                {a.slug} · {a.region} · {a.status}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
