import { ApiError, createApiClient } from '@superapp/api-client';
import {
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiUrl } from './runtime-config';
import { enrollmentTokens, localStorageTokens } from './storage';

/**
 * دالة لا ثابت: القيمة تأتي من الحقن وقت التشغيل، وقراءتها لحظة تحميل
 * الوحدة تسبق الحقن على الخادم.
 */
export const API_BASE_URL = apiUrl();

const USER_KEY = 'sa.admin.user';

/**
 * ‏HTTP مسموح في التطوير، وكذلك على الخادم وأثناء البناء.
 *
 * العنوان يُحقن وقت التشغيل، وقيمته أثناء `next build` مجرد نائب
 * (`http://localhost:3000`) لا يمرّ به أي طلب — فرض الفحص هناك يُسقط البناء
 * بلا فائدة. ما يهمّ هو المتصفح: هناك تُرسل كلمة المرور ورمز التجديد.
 */
const ALLOW_INSECURE_HTTP =
  process.env.NODE_ENV !== 'production' || typeof window === 'undefined';

/**
 * عميل API وحيد للوحة: يضيف /api/v1 وAuthorization وx-idempotency-key
 * ويجدد التوكن مرة واحدة عند 401 — عند الفشل النهائي يعيد إلى /login.
 */
export const api = createApiClient({
  baseUrl: API_BASE_URL,
  storage: localStorageTokens,
  allowInsecureHttp: ALLOW_INSECURE_HTTP,
  onUnauthorized: () => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(USER_KEY);
    } catch {
      // تجاهل — إعادة التوجيه كافية
    }
    if (!window.location.pathname.startsWith('/login')) {
      // السبب يُمرَّر: القذف الصامت إلى الدخول يجعل المستخدم يظنّ أن عمليته
      // هي التي فشلت، بينما جلسته هي التي انتهت — بعد تغيير كلمة المرور
      // مثلاً، وهو ما يُبطل الجلسات كلها بما فيها الحالية.
      window.location.href = '/login?reason=session';
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
  allowInsecureHttp: ALLOW_INSECURE_HTTP,
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
