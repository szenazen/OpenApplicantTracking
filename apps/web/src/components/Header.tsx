'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, Settings2 } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/lib/store';
import { AccountSwitcher } from './AccountSwitcher';
import { NotificationsBell } from './NotificationsBell';

const REGION_LABEL: Record<string, string> = {
  'us-east-1': '🇺🇸 US East',
  'eu-west-1': '🇪🇺 EU West',
  'ap-southeast-1': '🇸🇬 Singapore',
  'ap-northeast-1': '🇯🇵 Tokyo',
  'ap-southeast-2': '🇦🇺 Sydney',
};

// Top-level navigation. Previously "Jobs" pointed at `/dashboard` which
// conflated the recruiter home with the jobs index. Splitting them means
// the home page is the "what's happening now" dashboard and Jobs is the
// dedicated requisitions table — same pattern as most modern ATSes.
const NAV: Array<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: '/dashboard', label: 'Home', match: (p) => p === '/dashboard' },
  {
    href: '/dashboard/jobs',
    label: 'Jobs',
    match: (p) => p === '/dashboard/jobs' || p.startsWith('/dashboard/jobs/'),
  },
  { href: '/dashboard/candidates', label: 'Candidates', match: (p) => p.startsWith('/dashboard/candidates') },
];

export function Header() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const { me, activeAccountId, logout } = useAuth();
  const active = me?.accounts.find((a) => a.id === activeAccountId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const showAccountSettings = me?.accounts.some((a) => a.role === 'admin' || a.role === 'account_manager');
  const showPlatform = me?.platformAdmin === true;

  useEffect(() => {
    if (!settingsOpen) return;
    function onDocClick(ev: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(ev.target as Node)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [settingsOpen]);

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
      <div className="flex items-center gap-4">
        <div className="text-lg font-semibold tracking-tight">OpenATS</div>
        <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
          {NAV.map((item) => {
            const isActive = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                data-testid={`nav-${item.label.toLowerCase()}`}
                className={clsx(
                  'rounded-md px-2.5 py-1 font-medium',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
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
        {(showAccountSettings || showPlatform) && (
          <div className="relative" ref={settingsRef}>
            <button
              type="button"
              onClick={() => setSettingsOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              aria-expanded={settingsOpen}
              aria-haspopup="menu"
              data-testid="settings-menu-trigger"
            >
              <Settings2 size={16} className="text-slate-500" />
              Settings
              <ChevronDown size={14} className="text-slate-400" />
            </button>
            {settingsOpen && (
              <div
                className="absolute right-0 z-50 mt-1 min-w-[12rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                role="menu"
              >
                {showAccountSettings && (
                  <Link
                    href="/dashboard/settings/account"
                    role="menuitem"
                    className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => setSettingsOpen(false)}
                  >
                    Account settings
                  </Link>
                )}
                {showPlatform && (
                  <Link
                    href="/dashboard/settings/platform"
                    role="menuitem"
                    className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    onClick={() => setSettingsOpen(false)}
                  >
                    Platform admin
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
        <AccountSwitcher />
        <NotificationsBell />
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
