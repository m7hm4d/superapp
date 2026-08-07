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
import { enrollmentTokens, hasTokens, localStorageTokens } from './storage';

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

/** رد الدخول: جلسة كاملة، أو مطالبة بتسجيل جهاز المصادقة قبل أي وصول إداري */
type AdminLoginResponse =
  | { status: 'ok'; user: AuthUser; tokens: AuthTokens }
  | { status: 'totp_enrollment_required'; enrollmentToken: string; email: string }
  | {
      status: 'second_factor_required';
      stepUpToken: string;
      methods: ('totp' | 'passkey')[];
      email: string;
    };

export type LoginOutcome =
  | { kind: 'session'; user: AuthUser }
  | { kind: 'enrollment'; email: string }
  | { kind: 'second_factor'; stepUpToken: string; methods: ('totp' | 'passkey')[] };

export interface UseAuthResult {
  user: AuthUser | null;
  login: (email: string, password: string, totp?: string) => Promise<LoginOutcome>;
  /** تثبيت الجلسة بعد إتمام تسجيل TOTP */
  adoptSession: (user: AuthUser, tokens: AuthTokens) => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * useAuth(): المستخدم الحالي + دخول/خروج.
 * يعيد `second_factor` حين تصحّ كلمة المرور ويبقى العامل الثاني، و`enrollment`
 * حين لا يملك الحساب عاملاً بعد. كلمة المرور وحدها لا تُصدر جلسة أبداً.
 */
export function useAuth(): UseAuthResult {
  const user = useSyncExternalStore(subscribe, readUser, getServerSnapshot);
  const router = useRouter();

  const login = useCallback(async (email: string, password: string, totp?: string) => {
    const res = await api.post<AdminLoginResponse>('auth/admin/login', {
      email,
      password,
      ...(totp ? { totp } : {}),
    });
    if (res.status === 'second_factor_required') {
      // التوكن يبقى في الذاكرة فقط: عمره دقيقتان ولا معنى لبقائه بعد الصفحة
      return {
        kind: 'second_factor',
        stepUpToken: res.stepUpToken,
        methods: res.methods,
      } satisfies LoginOutcome;
    }
    if (res.status === 'totp_enrollment_required') {
      await enrollmentTokens.set({ accessToken: res.enrollmentToken, refreshToken: '' });
      return { kind: 'enrollment', email: res.email } satisfies LoginOutcome;
    }
    await localStorageTokens.set(res.tokens);
    writeUser(res.user);
    return { kind: 'session', user: res.user } satisfies LoginOutcome;
  }, []);

  const adoptSession = useCallback(async (nextUser: AuthUser, tokens: AuthTokens) => {
    await localStorageTokens.set(tokens);
    await enrollmentTokens.clear();
    writeUser(nextUser);
  }, []);

  const logout = useCallback(async () => {
    await localStorageTokens.clear();
    await enrollmentTokens.clear();
    writeUser(null);
    router.replace('/login');
  }, [router]);

  return { user, login, adoptSession, logout };
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
