import { create } from 'zustand';
import type { NewOrderEvent } from '@superapp/shared';

/**
 * تنبيه «طلب جديد» (M-02): Overlay قابل للإخفاء ولا يفتح التفاصيل تلقائياً.
 * يبقى الاهتزاز يعمل حتى يُقرّ البائع بالتنبيه.
 */
interface AlertState {
  pending: NewOrderEvent | null;
  seenEventIds: string[];
  push: (e: NewOrderEvent) => void;
  dismiss: () => void;
}

export const useAlertStore = create<AlertState>((set, get) => ({
  pending: null,
  seenEventIds: [],
  push: (e) => {
    // dedup بواسطة eventId — الـsocket قد يعيد الإرسال عند إعادة الاتصال
    if (get().seenEventIds.includes(e.eventId)) return;
    set((s) => ({
      pending: e,
      seenEventIds: [...s.seenEventIds.slice(-49), e.eventId],
    }));
  },
  dismiss: () => set({ pending: null }),
}));
