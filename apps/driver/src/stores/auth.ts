import type { AuthUser } from '@superapp/shared';
import { create } from 'zustand';
import { client, storage } from '../lib/api';
import type { DriverProfile } from '../types';

interface MeResponse {
  user: AuthUser;
  profile: DriverProfile | null;
}

interface AuthState {
  user: AuthUser | null;
  profile: DriverProfile | null;
  status: 'loading' | 'guest' | 'authed';
  hydrate(): Promise<void>;
  setSession(user: AuthUser): void;
  setProfile(profile: DriverProfile | null): void;
  setLoggedOut(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  status: 'loading',

  async hydrate() {
    try {
      const access = await storage.getAccess();
      if (!access) {
        set({ user: null, profile: null, status: 'guest' });
        return;
      }
      const me = await client.get<MeResponse>('auth/me');
      set({
        user: { ...me.user, approvalStatus: me.profile?.approvalStatus ?? me.user.approvalStatus },
        profile: me.profile,
        status: 'authed',
      });
    } catch {
      set({ user: null, profile: null, status: 'guest' });
    }
  },

  setSession(user) {
    set({ user, status: 'authed' });
  },

  setProfile(profile) {
    set((state) => ({
      profile,
      user:
        state.user && profile
          ? { ...state.user, approvalStatus: profile.approvalStatus }
          : state.user,
    }));
  },

  setLoggedOut() {
    set({ user: null, profile: null, status: 'guest' });
  },
}));

/** تسجيل الخروج: مسح الرموز ثم إسقاط الجلسة (حارس التوجيه يعيد لشاشة الدخول) */
export async function logout(): Promise<void> {
  await storage.clear();
  useAuthStore.getState().setLoggedOut();
}
