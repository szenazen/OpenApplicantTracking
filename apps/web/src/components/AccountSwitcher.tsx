'use client';

import { useAuth } from '@/lib/store';
import { useRouter } from 'next/navigation';

/**
 * Simple <select> account switcher. Triggers a full nav reset to /dashboard
 * so the jobs list re-fetches from the newly-active account's region.
 */
export function AccountSwitcher() {
  const router = useRouter();
  const { me, activeAccountId, setActiveAccountId } = useAuth();
  if (!me || me.accounts.length === 0) return null;

  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">Active account</span>
      <select
        data-testid="account-switcher"
        value={activeAccountId ?? ''}
        onChange={(e) => {
          setActiveAccountId(e.target.value);
          router.push('/dashboard');
          router.refresh();
        }}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      >
        {me.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {a.region}
          </option>
        ))}
      </select>
    </label>
  );
}
