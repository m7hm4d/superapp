import { create } from 'zustand';

/**
 * علم عالمي: أي طلب باكند رجع 403 PENDING_APPROVAL يرفع هذا العلم
 * فيوجَّه البائع إلى شاشة M-01 (حالة التفعيل).
 */
interface ApprovalState {
  blocked: boolean;
  /** pending | rejected | suspended — من جسم الخطأ إن توفر */
  status?: string;
  reason?: string;
  setBlocked: (info: { status?: string; reason?: string }) => void;
  clear: () => void;
}

export const useApprovalStore = create<ApprovalState>((set) => ({
  blocked: false,
  status: undefined,
  reason: undefined,
  setBlocked: (info) => set({ blocked: true, status: info.status, reason: info.reason }),
  clear: () => set({ blocked: false, status: undefined, reason: undefined }),
}));
