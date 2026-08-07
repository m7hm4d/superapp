'use client';

import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import type { AuthTokens, AuthUser } from '@superapp/shared';
import { Button } from '@/components/ui';
import { TotpEnroll, type TotpSetupResponse } from '@/components/totp-enroll';
import { enrollApi } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { hasEnrollmentToken } from '@/lib/storage';

/**
 * A-01/2: تسجيل جهاز المصادقة إلزامي قبل أي وصول إداري.
 * تُفتح بعد دخول ناجح بالبريد وكلمة المرور لحساب لم يسجّل جهازه بعد،
 * وتنتهي بجلسة كاملة فور تأكيد أول رمز.
 */

const ERROR_AR: Record<string, string> = {
  TOTP_INVALID: 'الرمز غير صحيح — جرّب الرمز الظاهر الآن في التطبيق',
  TOTP_NOT_SETUP: 'انتهت مهلة التسجيل — أعد تسجيل الدخول',
  TOKEN_SCOPE_FORBIDDEN: 'انتهت مهلة التسجيل — أعد تسجيل الدخول',
  INVALID_TOKEN: 'انتهت مهلة التسجيل — أعد تسجيل الدخول',
  NO_TOKEN: 'انتهت مهلة التسجيل — أعد تسجيل الدخول',
  VALIDATION_ERROR: 'أدخل رمزاً من ٦ أرقام',
};

function arError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر إتمام التسجيل (${e.code})`;
  return 'تعذر الاتصال بالخادم — تأكد من الشبكة وحاول مجدداً';
}

export default function EnrollPage() {
  const router = useRouter();
  const { adoptSession } = useAuth();
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const setupMutation = useMutation({
    mutationFn: () => enrollApi.post<TotpSetupResponse>('auth/admin/totp/setup'),
    onSuccess: (data) => {
      setError(null);
      setSetup(data);
    },
    onError: (e) => {
      setError(arError(e));
      if (e instanceof ApiError && ['INVALID_TOKEN', 'NO_TOKEN'].includes(e.code)) {
        setExpired(true);
      }
    },
  });

  const enableMutation = useMutation({
    mutationFn: (totp: string) =>
      enrollApi.post<{ user: AuthUser; tokens: AuthTokens }>('auth/admin/totp/enable', { totp }),
    onSuccess: async (res) => {
      await adoptSession(res.user, res.tokens);
      router.replace('/overview');
    },
    onError: (e) => setError(arError(e)),
  });

  // بلا توكن تسجيل لا معنى للصفحة — أعِد إلى الدخول
  useEffect(() => {
    if (!hasEnrollmentToken()) {
      router.replace('/login');
      return;
    }
    setupMutation.mutate();
    // مرة واحدة عند فتح الصفحة
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white">
            <ShieldCheck size={24} aria-hidden />
          </span>
          <h1 className="text-xl font-bold text-zinc-900">تفعيل المصادقة الثنائية</h1>
          <p className="text-sm text-zinc-500">
            حسابات الإدارة تتطلب رمزاً من تطبيق المصادقة في كل دخول — سجّل جهازك مرة واحدة.
          </p>
        </div>

        <div className="rounded-card border border-zinc-200 bg-white p-6 shadow-sm">
          {expired ? (
            <div className="space-y-3 text-sm">
              <p className="text-red-600">{error}</p>
              <Button className="w-full" onClick={() => router.replace('/login')}>
                العودة لتسجيل الدخول
              </Button>
            </div>
          ) : setup ? (
            <TotpEnroll
              setup={setup}
              submitting={enableMutation.isPending}
              error={error}
              onConfirm={(code) => enableMutation.mutate(code)}
            />
          ) : (
            <div className="space-y-3">
              <div className="h-56 animate-pulse rounded-lg bg-zinc-100" />
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
