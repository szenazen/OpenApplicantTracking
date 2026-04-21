'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/lib/store';
import { AccountSwitcher } from './AccountSwitcher';

const REGION_LABEL: Record<string, string> = {
  'us-east-1': '🇺🇸 US East',
  'eu-west-1': '🇪🇺 EU West',
  'ap-southeast-1': '🇸🇬 Singapore',
  'ap-northeast-1': '🇯🇵 Tokyo',
  'ap-southeast-2': '🇦🇺 Sydney',
};

export function Header() {
  const router = useRouter();
  const { me, activeAccountId, logout } = useAuth();
  const active = me?.accounts.find((a) => a.id === activeAccountId);

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <div className="flex items-center gap-3">
        <div className="text-lg font-semibold tracking-tight">OpenATS</div>
        {active && (
          <span
            className="ml-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
            data-testid="active-region-badge"
          >
            {REGION_LABEL[active.region] ?? active.region}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <AccountSwitcher />
        <span className="text-sm text-slate-600">{me?.email}</span>
        <button
          onClick={() => {
            logout();
            router.replace('/login');
          }}
          className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          aria-label="Sign out"
        >
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </header>
  );
}
