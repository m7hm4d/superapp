import type { AuthUser } from '@superapp/shared';
import { create } from 'zustand';
import { api } from '../lib/api';

interface AuthState {
  user: AuthUser | null;
  status: 'loading' | 'guest' | 'authed';
  hydrate: () => Promise<void>;
  setSession: (user: AuthUser) => void;
  setLoggedOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'loading',

  /** عند الإقلاع: توكن محفوظ → auth/me، وإلا ضيف (التصفح مسموح دون حساب) */
  hydrate: async () => {
    try {
      const access = await api.storage.getAccess();
      if (!access) {
        set({ user: null, status: 'guest' });
        return;
      }
      const me = await api.get<{ user: AuthUser }>('auth/me');
      set({ user: me.user, status: 'authed' });
    } catch {
      // فشل التجديد ينظف التخزين عبر onUnauthorized؛ أي فشل آخر → ضيف
      set({ user: null, status: 'guest' });
    }
  },

  setSession: (user) => set({ user, status: 'authed' }),
  setLoggedOut: () => set({ user: null, status: 'guest' }),
}));
