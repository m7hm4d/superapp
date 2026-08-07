import { createApiClient, expoSecureStorage } from '@superapp/api-client';
import type { ApiClient } from '@superapp/api-client';
import { authStore } from '../stores/auth';
import { useApprovalStore } from '../stores/approval';

export const storage = expoSecureStorage();

const baseClient = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
  storage,
  onUnauthorized: () => authStore.getState().setLoggedOut(),
  // ‏__DEV__ ثابت يستبدله Metro وقت البناء: نسخة الإصدار تصير `false`
  // فيُرفض أي عنوان غير https قبل أول طلب.
  allowInsecureHttp: __DEV__,
});

/** استخراج code من ApiError بأمان (duck-typing كي لا نعتمد على instanceof عبر الحزم) */
export function apiErrorCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export function apiErrorStatus(e: unknown): number | undefined {
  if (e && typeof e === 'object' && 'status' in e) {
    const status = (e as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

export function apiErrorMessage(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'message' in e) {
    const message = (e as { message?: unknown }).message;
    return typeof message === 'string' && message.length > 0 ? message : undefined;
  }
  return undefined;
}

function apiErrorBody(e: unknown): Record<string, unknown> | undefined {
  if (e && typeof e === 'object' && 'body' in e) {
    const body = (e as { body?: unknown }).body;
    if (body && typeof body === 'object') return body as Record<string, unknown>;
  }
  return undefined;
}

/**
 * الخطاف العالمي (M-01): أي 403 PENDING_APPROVAL يرفع علم الحجب
 * فيعيد التوجيه إلى شاشة حالة التفعيل — ثم يُرمى الخطأ لمن يهمه.
 */
function guard<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((e: unknown) => {
    const code = apiErrorCode(e);
    if (code === 'PENDING_APPROVAL' || code === 'BLOCKED') {
      const body = apiErrorBody(e) ?? {};
      const status =
        typeof body.approvalStatus === 'string'
          ? body.approvalStatus
          : code === 'BLOCKED'
            ? 'suspended'
            : 'pending';
      const reason =
        typeof body.reason === 'string'
          ? body.reason
          : typeof body.rejectionReason === 'string'
            ? body.rejectionReason
            : apiErrorMessage(e);
      useApprovalStore.getState().setBlocked({ status, reason });
    }
    throw e;
  });
}

export const api: ApiClient = {
  ...baseClient,
  get: <T,>(path: string, query?: Record<string, unknown>) =>
    guard(baseClient.get<T>(path, query)),
  post: <T,>(path: string, body?: unknown) => guard(baseClient.post<T>(path, body)),
  patch: <T,>(path: string, body?: unknown) => guard(baseClient.patch<T>(path, body)),
  delete: <T,>(path: string, body?: unknown) => guard(baseClient.delete<T>(path, body)),
};

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * تسجيل خروج يدوي: إبطال الجلسة على الخادم ثم تحويل الحالة إلى ضيف.
 *
 * كان يمسح التوكنات محلياً فقط، فيبقى رمز التحديث صالحاً على الخادم.
 */
export async function logout(): Promise<void> {
  try {
    await api.logout();
  } finally {
    useApprovalStore.getState().clear();
    authStore.getState().setLoggedOut();
  }
}
