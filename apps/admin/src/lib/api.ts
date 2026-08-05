import { ApiError, createApiClient } from '@superapp/api-client';
import {
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import { enrollmentTokens, localStorageTokens } from './storage';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const USER_KEY = 'sa.admin.user';

/**
 * عميل API وحيد للوحة: يضيف /api/v1 وAuthorization وx-idempotency-key
 * ويجدد التوكن مرة واحدة عند 401 — عند الفشل النهائي يعيد إلى /login.
 */
export const api = createApiClient({
  baseUrl: API_BASE_URL,
  storage: localStorageTokens,
  onUnauthorized: () => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(USER_KEY);
    } catch {
      // تجاهل — إعادة التوجيه كافية
    }
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  },
});

/**
 * عميل تسجيل TOTP: يحمل التوكن المحدود بدل توكن الجلسة، بلا تجديد ولا
 * إعادة توجيه — انتهاء صلاحيته يعالجه مسار التسجيل نفسه.
 */
export const enrollApi = createApiClient({
  baseUrl: API_BASE_URL,
  storage: enrollmentTokens,
});

export { ApiError };

/** غلاف رفيع: useApiQuery(['admin','orders', filters], 'admin/orders', filters) */
export function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  query?: Record<string, unknown>,
  options?: Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>,
): UseQueryResult<T, ApiError> {
  return useQuery<T, ApiError>({
    queryKey: key,
    queryFn: () => api.get<T>(path, query),
    ...options,
  });
}

/** غلاف رفيع: useApiMutation((vars) => api.post(...), { onSuccess }) */
export function useApiMutation<TData, TVars = void>(
  mutationFn: (vars: TVars) => Promise<TData>,
  options?: Omit<UseMutationOptions<TData, ApiError, TVars>, 'mutationFn'>,
): UseMutationResult<TData, ApiError, TVars> {
  return useMutation<TData, ApiError, TVars>({ mutationFn, ...options });
}
