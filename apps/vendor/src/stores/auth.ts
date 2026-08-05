import { create } from 'zustand';
import type { AuthUser } from '@superapp/shared';

export type AuthStatus = 'loading' | 'guest' | 'authed';

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  hydrate: () => Promise<void>;
  setSession: (user: AuthUser) => void;
  setLoggedOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'loading',
  /** عند الإقلاع: إن وُجد توكن محفوظ نجلب auth/me وإلا نبقى ضيفاً */
  hydrate: async () => {
    // استيراد كسول لتفادي دورة الاعتماد مع src/lib/api.ts
    const { api, storage } = await import('../lib/api');
    try {
      const access = await storage.getAccess();
      if (!access) {
        set({ user: null, status: 'guest' });
        return;
      }
      const me = await api.get<{
        user: AuthUser;
        profile?: { approvalStatus?: string; rejectionReason?: string | null };
      }>('auth/me');
      const approval = me.profile?.approvalStatus ?? me.user.approvalStatus;
      if (approval && approval !== 'approved') {
        const { useApprovalStore } = await import('./approval');
        useApprovalStore.getState().setBlocked({
          status: approval,
          reason: me.profile?.rejectionReason ?? undefined,
        });
      }
      set({ user: me.user, status: 'authed' });
    } catch {
      // فشل الشبكة أو انتهاء الجلسة: التعامل يتم في onUnauthorized،
      // وإن كان انقطاعاً فقط نُبقي المستخدم ضيفاً ليعيد الدخول.
      set((s) => (s.status === 'loading' ? { ...s, user: null, status: 'guest' } : s));
    }
  },
  setSession: (user) => set({ user, status: 'authed' }),
  setLoggedOut: () => set({ user: null, status: 'guest' }),
}));

export const authStore = useAuthStore;
