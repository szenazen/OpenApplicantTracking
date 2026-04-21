/**
 * Small UI formatting helpers used across the dashboard (Kanban cards, headers).
 *
 * These are intentionally framework-free so they can be unit-tested in isolation
 * and reused by any future candidate/job views.
 */

/** Return 1-2 uppercase initials from a person's name. */
export function getInitials(firstName?: string | null, lastName?: string | null): string {
  const f = (firstName ?? '').trim();
  const l = (lastName ?? '').trim();
  const a = f ? f[0]! : '';
  const b = l ? l[0]! : '';
  const initials = (a + b).toUpperCase();
  if (initials) return initials;
  // Fallback: take first two alnum chars of either string
  const joined = (f + l).replace(/[^A-Za-z0-9]/g, '');
  return joined.slice(0, 2).toUpperCase() || '?';
}

/**
 * Deterministic pastel-ish avatar background for a given seed string.
 * We pick from a small curated palette so colors remain on-brand.
 * Returns a Tailwind class string (`bg-...`) plus a readable foreground class.
 */
const AVATAR_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: 'bg-rose-100', fg: 'text-rose-700' },
  { bg: 'bg-pink-100', fg: 'text-pink-700' },
  { bg: 'bg-fuchsia-100', fg: 'text-fuchsia-700' },
  { bg: 'bg-violet-100', fg: 'text-violet-700' },
  { bg: 'bg-indigo-100', fg: 'text-indigo-700' },
  { bg: 'bg-blue-100', fg: 'text-blue-700' },
  { bg: 'bg-sky-100', fg: 'text-sky-700' },
  { bg: 'bg-teal-100', fg: 'text-teal-700' },
  { bg: 'bg-emerald-100', fg: 'text-emerald-700' },
  { bg: 'bg-amber-100', fg: 'text-amber-700' },
  { bg: 'bg-orange-100', fg: 'text-orange-700' },
];

export function avatarColor(seed: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[idx]!;
}

/**
 * Compact relative duration like the reference UI: `3y`, `5mo`, `12d`, `4h`, `9m`, `now`.
 * Negative or invalid input returns empty string.
 */
export function formatRelativeDuration(iso?: string | Date | null, now: Date = new Date()): string {
  if (!iso) return '';
  const then = iso instanceof Date ? iso : new Date(iso);
  const ms = now.getTime() - then.getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  const yr = Math.floor(day / 365);
  return `${yr}y`;
}

/** Years of experience as a short label. Returns '' if unknown. */
export function formatYearsExperience(years?: number | null): string {
  if (years === null || years === undefined) return '';
  if (!Number.isFinite(years) || years < 0) return '';
  if (years === 0) return '<1y';
  return `${Math.floor(years)}y`;
}
