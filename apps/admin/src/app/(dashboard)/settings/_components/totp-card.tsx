'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import type { AuthTokens, AuthUser } from '@superapp/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui';
import { TotpEnroll, type TotpSetupResponse } from '@/components/totp-enroll';

interface TotpStatus {
  enabled: boolean;
  pending: boolean;
}

const ERROR_AR: Record<string, string> = {
  TOTP_INVALID: 'الرمز غير صحيح — تأكد من تطبيق المصادقة وحاول مجدداً',
  TOTP_NOT_SETUP: 'ابدأ بالإعداد أولاً ثم أدخل الرمز',
  VALIDATION_ERROR: 'أدخل رمزاً من ٦ أرقام',
};

function arError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر تنفيذ العملية (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

export function TotpCard() {
  const { adoptSession } = useAuth();
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [justEnabled, setJustEnabled] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['totp', 'status'],
    queryFn: () => api.get<TotpStatus>('auth/admin/totp/status'),
  });

  const setupMutation = useMutation({
    mutationFn: () => api.post<TotpSetupResponse>('auth/admin/totp/setup'),
    onSuccess: (data) => {
      setBanner(null);
      setJustEnabled(false);
      setSetup(data);
    },
    onError: (e) => setBanner(arError(e)),
  });

  const enableMutation = useMutation({
    mutationFn: (totp: string) =>
      api.post<{ user: AuthUser; tokens: AuthTokens }>('auth/admin/totp/enable', { totp }),
    onSuccess: async (res) => {
      // الخادم يصدر جلسة جديدة عند التفعيل — نتبنّاها كي لا تُبطل الجلسة الحالية
      await adoptSession(res.user, res.tokens);
      setBanner(null);
      setSetup(null);
      setJustEnabled(true);
      void statusQuery.refetch();
    },
    onError: (e) => setBanner(arError(e)),
  });

  const enabled = statusQuery.data?.enabled ?? false;

  return (
    <div className="space-y-4 text-sm">
      {banner && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          {banner}
        </div>
      )}

      {justEnabled && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">
          سُجّل الجهاز الجديد بنجاح — استخدمه في عمليات الدخول القادمة.
        </div>
      )}

      {setup ? (
        <>
          <p className="text-zinc-600">
            {enabled
              ? 'تسجيل جهاز جديد — جهازك الحالي يبقى فعّالاً حتى تؤكد الرمز من الجهاز الجديد.'
              : 'سجّل جهازك لإكمال تفعيل المصادقة الثنائية.'}
          </p>
          <TotpEnroll
            setup={setup}
            submitting={enableMutation.isPending}
            error={null}
            onConfirm={(code) => enableMutation.mutate(code)}
          />
          <Button variant="secondary" size="sm" onClick={() => setSetup(null)}>
            إلغاء
          </Button>
        </>
      ) : (
        <>
          {statusQuery.isPending ? (
            <div className="h-5 w-56 animate-pulse rounded bg-zinc-100" />
          ) : enabled ? (
            <p className="text-green-700">
              المصادقة الثنائية مفعّلة — يُطلب رمز من تطبيق المصادقة في كل دخول.
            </p>
          ) : (
            <p className="text-amber-700">
              غير مفعّلة على هذا الحساب — لن تتمكن من الدخول قبل تسجيل جهاز مصادقة.
            </p>
          )}
          <Button
            variant={enabled ? 'secondary' : 'primary'}
            loading={setupMutation.isPending}
            onClick={() => setupMutation.mutate()}
          >
            {enabled ? 'تسجيل جهاز جديد' : 'تفعيل المصادقة الثنائية'}
          </Button>
          {enabled && (
            <p className="text-xs text-zinc-500">
              تسجيل جهاز جديد يستبدل الجهاز الحالي بعد تأكيد أول رمز منه.
            </p>
          )}
        </>
      )}
    </div>
  );
}
