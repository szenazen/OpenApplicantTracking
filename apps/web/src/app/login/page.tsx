'use client';

export const dynamic = 'force-dynamic';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, LoginResponse, MeResponse } from '@/lib/api';
import { useAuth } from '@/lib/store';

export default function LoginPage() {
  const router = useRouter();
  const { setToken, setMe, setActiveAccountId } = useAuth();
  const [email, setEmail] = useState('demo@openapplicanttracking.local');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const login = await api<LoginResponse>('/auth/login', { body: { email, password } });
      setToken(login.accessToken);
      // Fetch the profile so we know which accounts the user has access to.
      const me = await api<MeResponse>('/auth/me');
      setMe(me);
      if (me.accounts.length > 0) setActiveAccountId(me.accounts[0]!.id);
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Unexpected error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex h-full items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg"
        aria-label="Sign in"
      >
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mb-6 text-sm text-slate-500">OpenApplicantTracking</p>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </label>

        <label className="mb-6 block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </label>

        {error && (
          <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-6 text-center text-xs text-slate-400">
          Demo: <code>demo@openapplicanttracking.local</code> / <code>demo1234</code>
        </p>
      </form>
    </main>
  );
}
