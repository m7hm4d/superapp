import { createApiClient, expoSecureStorage } from '@superapp/api-client';
import { useAuthStore } from '../stores/auth';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const storage = expoSecureStorage();

export const client = createApiClient({
  baseUrl: API_URL,
  storage,
  onUnauthorized: () => useAuthStore.getState().setLoggedOut(),
});
