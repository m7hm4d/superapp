'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { AuthTokens, AuthUser } from '@superapp/shared';
import { api } from './api';
import { hasTokens, localStorageTokens } from './storage';

const USER_KEY = 'sa.admin.user';
const AUTH_EVENT = 'sa:auth-changed';

let cachedUser: AuthUser | null = null;
let hydrated = false;

function readUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  if (!hydrated) {
    hydrated = true;
    try {
      const raw = window.localStorage.getItem(USER_KEY);
      cachedUser = raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      cachedUser = null;
    }
  }
  return cachedUser;
}

function writeUser(user: AuthUser | null): void {
  cachedUser = user;
  hydrated = true;
  if (typeof window === 'undefined') return;
  try {
    if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(USER_KEY);
  } catch {
    // التخزين المحلي غير متاح — تبقى الجلسة بالذاكرة فقط
  }
  window.dispatchEvent(new Event(AUTH_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = () => {
    // تغيّر من تبويب آخر — أعد القراءة من التخزين
    hydrated = false;
    onChange();
  };
  window.addEventListener(AUTH_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(AUTH_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function getServerSnapshot(): AuthUser | null {
  return null;
}

export interface UseAuthResult {
  user: AuthUser | null;
  login: (email: string, password: string, totp?: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

/**
 * useAuth(): المستخدم الحالي + دخول/خروج.
 * يرمي login خطأ ApiError — code === 'TOTP_REQUIRED' يعني أظهر حقل الرمز.
 */
export function useAuth(): UseAuthResult {
  const user = useSyncExternalStore(subscribe, readUser, getServerSnapshot);
  const router = useRouter();

  const login = useCallback(
    async (email: string, password: string, totp?: string) => {
      const res = await api.post<{ user: AuthUser; tokens: AuthTokens }>(
        'auth/admin/login',
        { email, password, ...(totp ? { totp } : {}) },
      );
      await localStorageTokens.set(res.tokens);
      writeUser(res.user);
      return res.user;
    },
    [],
  );

  const logout = useCallback(async () => {
    await localStorageTokens.clear();
    writeUser(null);
    router.replace('/login');
  }, [router]);

  return { user, login, logout };
}

/**
 * حارس لوحة الإدارة: بلا توكن → /login.
 * يُغلّف layout مجموعة (dashboard) — الصفحات لا تحتاج أي فحص إضافي.
 */
export function RequireAuth({ children }: { children: ReactNode }): ReactNode {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasTokens()) {
      router.replace('/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-muted">
        <p className="text-sm text-zinc-500">جارٍ التحقق من الجلسة…</p>
      </div>
    );
  }
  return <>{children}</>;
}
