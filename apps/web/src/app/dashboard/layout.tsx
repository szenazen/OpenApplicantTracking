'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, MeResponse } from '@/lib/api';
import { useAuth } from '@/lib/store';
import { Header } from '@/components/Header';
import { CommandPalette } from '@/components/CommandPalette';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { token, me, activeAccountId, setMe, setActiveAccountId } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Guard: if there's no persisted token, kick to /login.
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('oat.token') : null;
    if (!token && !stored) {
      router.replace('/login');
      return;
    }
    // Refresh the /auth/me profile on every dashboard mount so the account list is fresh.
    api<MeResponse>('/auth/me')
      .then((m) => {
        setMe(m);
        if (!activeAccountId && m.accounts.length > 0) setActiveAccountId(m.accounts[0]!.id);
        setReady(true);
      })
      .catch(() => {
        router.replace('/login');
      });
  }, [token, router, setMe, setActiveAccountId, activeAccountId]);

  if (!ready || !me) {
    return (
      <main className="flex h-full items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </main>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <Header />
      <main className="flex-1 overflow-auto">{children}</main>
      <CommandPalette />
    </div>
  );
}
