'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const t = typeof window !== 'undefined' ? window.localStorage.getItem('oat.token') : null;
    router.replace(t ? '/dashboard' : '/login');
  }, [router]);
  return (
    <main className="flex h-full items-center justify-center">
      <p className="text-slate-500">Loading…</p>
    </main>
  );
}
