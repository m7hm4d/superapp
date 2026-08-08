'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { AuthTokens, AuthUser } from '@superapp/shared';
import { api } from '@/lib/api';
import { authErrorAr } from '@/lib/auth-errors';
import { useAuth } from '@/lib/auth';
import { Button, Input } from '@/components/ui';
import { TotpEnroll, type TotpSetupResponse } from '@/components/totp-enroll';

interface TotpStatus {
  enabled: boolean;
  pending: boolean;
}

export function TotpCard() {
  const { adoptSession } = useAuth();
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [justEnabled, setJustEnabled] = useState(false);
  // إثبات إعادة التحقق — يظهر فقط عند استبدال جهاز قائم
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthTotp, setReauthTotp] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);

  const statusQuery = useQuery({
    queryKey: ['totp', 'status'],
    queryFn: () => api.get<TotpStatus>('auth/admin/totp/status'),
  });

  const setupMutation = useMutation({
    // استبدال جهاز قائم يشترط إثباتاً حديثاً: بلا هذا كانت جلسة مسروقة
    // وحدها تكفي لانتزاع العامل الثاني من صاحبه.
    mutationFn: () =>
      api.post<TotpSetupResponse>(
        'auth/admin/totp/setup',
        enabled
          ? { password: reauthPassword, ...(useRecovery ? { recoveryCode } : { totp: reauthTotp }) }
          : undefined,
      ),
    onSuccess: (data) => {
      setBanner(null);
      setJustEnabled(false);
      setSetup(data);
    },
    onError: (e) => setBanner(authErrorAr(e)),
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
    onError: (e) => setBanner(authErrorAr(e)),
  });

  const enabled = statusQuery.data?.enabled ?? false;

  /** حقول الإثبات: تظهر عند الاستبدال وحده — التسجيل الأول لا عامل قائم له */
  const reauthFields = enabled && !setup && (
    <div className="grid max-w-md gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-zinc-600">
        لتسجيل جهاز جديد أثبت أنك ما زلت تملك الحالي: أدخل كلمة مرورك والرمز
        السداسي من تطبيق المصادقة الذي تستعمله الآن. وإن كان الجهاز ضائعاً
        فاستعمل رمز استرداد.
      </p>
      <p className="text-zinc-500">
        بلا هذا الإثبات تكفي جلسة مسروقة لانتزاع عاملك الثاني. والاستبدال يُبطل
        جلساتك ورموز استردادك القديمة.
      </p>
      <Input
        label="كلمة المرور"
        type="password"
        autoComplete="current-password"
        value={reauthPassword}
        onChange={(e) => setReauthPassword(e.target.value)}
      />
      {useRecovery ? (
        <Input
          label="رمز استرداد"
          autoComplete="off"
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          className="font-mono"
          value={recoveryCode}
          onChange={(e) => setRecoveryCode(e.target.value)}
        />
      ) : (
        <Input
          label="الرمز من تطبيق المصادقة الحالي"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="******"
          className="font-mono tracking-widest"
          value={reauthTotp}
          onChange={(e) => setReauthTotp(e.target.value.replace(/\D/g, ''))}
        />
      )}
      <button
        type="button"
        onClick={() => setUseRecovery((v) => !v)}
        className="justify-self-start text-sm text-brand-600 underline"
      >
        {useRecovery
          ? 'استعمال رمز تطبيق المصادقة'
          : 'فقدتُ جهازي — استعمال رمز استرداد'}
      </button>
    </div>
  );

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
          {reauthFields}
          <Button
            variant={enabled ? 'secondary' : 'primary'}
            loading={setupMutation.isPending}
            disabled={
              enabled &&
              (reauthPassword.length === 0 ||
                (useRecovery ? recoveryCode.trim().length < 8 : !/^\d{6}$/.test(reauthTotp)))
            }
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
