'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MeResponse } from './api';

/**
 * Global auth + active-account store.
 *
 * Persisted in localStorage so a page refresh keeps you logged in and on the
 * same account. The server's JWT + the active account id are the only things
 * that matter for API calls; `me` is a cached profile for UI convenience.
 */
interface AuthState {
  token: string | null;
  me: MeResponse | null;
  activeAccountId: string | null;
  setToken: (t: string | null) => void;
  setMe: (m: MeResponse | null) => void;
  setActiveAccountId: (id: string | null) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      me: null,
      activeAccountId: null,
      setToken: (token) => {
        if (typeof window !== 'undefined') {
          if (token) window.localStorage.setItem('oat.token', token);
          else window.localStorage.removeItem('oat.token');
        }
        set({ token });
      },
      setMe: (me) => set({ me }),
      setActiveAccountId: (id) => {
        if (typeof window !== 'undefined') {
          if (id) window.localStorage.setItem('oat.activeAccountId', id);
          else window.localStorage.removeItem('oat.activeAccountId');
        }
        set({ activeAccountId: id });
      },
      logout: () => {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem('oat.token');
          window.localStorage.removeItem('oat.activeAccountId');
        }
        set({ token: null, me: null, activeAccountId: null });
      },
    }),
    { name: 'oat.auth' },
  ),
);
