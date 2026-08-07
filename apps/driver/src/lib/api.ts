import { createApiClient, expoSecureStorage } from '@superapp/api-client';
import { useAuthStore } from '../stores/auth';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const storage = expoSecureStorage();

export const client = createApiClient({
  baseUrl: API_URL,
  storage,
  onUnauthorized: () => useAuthStore.getState().setLoggedOut(),
  // ‏__DEV__ ثابت يستبدله Metro وقت البناء: نسخة الإصدار تصير `false`
  // فيُرفض أي عنوان غير https قبل أول طلب.
  allowInsecureHttp: __DEV__,
});
