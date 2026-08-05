import type { TokenStorage } from '@superapp/api-client';

/**
 * محوّل تخزين التوكنات على localStorage للوحة الإدارة.
 * مفاتيح خاصة باللوحة كي لا تتصادم مع أي تطبيق آخر على نفس الأصل.
 */
const ACCESS_KEY = 'sa.admin.access';
const REFRESH_KEY = 'sa.admin.refresh';

function ls(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const localStorageTokens: TokenStorage = {
  async getAccess() {
    return ls()?.getItem(ACCESS_KEY) ?? null;
  },
  async getRefresh() {
    return ls()?.getItem(REFRESH_KEY) ?? null;
  },
  async set(tokens) {
    const s = ls();
    if (!s) return;
    s.setItem(ACCESS_KEY, tokens.accessToken);
    s.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  async clear() {
    const s = ls();
    if (!s) return;
    s.removeItem(ACCESS_KEY);
    s.removeItem(REFRESH_KEY);
  },
};

/** فحص متزامن لوجود جلسة — للتوجيه الأولي فقط، الحقيقة عند الخادم. */
export function hasTokens(): boolean {
  const s = ls();
  return !!(s?.getItem(ACCESS_KEY) || s?.getItem(REFRESH_KEY));
}

/** قراءة متزامنة لتوكن الوصول — يحتاجها اتصال socket. */
export function getAccessTokenSync(): string | null {
  return ls()?.getItem(ACCESS_KEY) ?? null;
}
