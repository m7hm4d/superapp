import { createApiClient, expoSecureStorage } from '@superapp/api-client';
import { useAuthStore } from '../stores/auth';

export const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * عميل REST الوحيد للتطبيق — يحقن Authorization وx-idempotency-key
 * ويجدد التوكن مرة واحدة عند 401 (انظر عقد @superapp/api-client).
 */
export const api = createApiClient({
  baseUrl: BASE_URL,
  storage: expoSecureStorage(),
  onUnauthorized: () => useAuthStore.getState().setLoggedOut(),
});

/** استخراج code من ApiError دون افتراضات على نوع الخطأ */
export function apiErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export function apiErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' && message.length > 0 ? message : undefined;
  }
  return undefined;
}

export function apiErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}
