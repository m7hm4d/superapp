'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { authErrorAr } from '@/lib/auth-errors';
import { Button, Input } from '@/components/ui';

/**
 * تغيير كلمة مرور الإدارة.
 *
 * قبل هذه الشاشة كان التدوير يمرّ بالخادم وSSH، فتبقى الكلمة في تاريخ
 * الصدفة — وقد وقع ذلك فعلاً في هذا المشروع.
 */
export function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [totp, setTotp] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ ok: true }>('auth/admin/password', {
        currentPassword: current,
        newPassword: next,
        ...(useRecovery ? { recoveryCode } : { totp }),
      }),
    onSuccess: () => {
      // النجاح يُبطل الجلسات كلها بما فيها هذه — فالتحويل وصف لما حدث
      // لا اختيار في الواجهة.
      setDone(true);
      setTimeout(() => {
        window.location.href = '/login';
      }, 2500);
    },
    onError: (e) => setBanner(authErrorAr(e)),
  });

  if (done) {
    return (
      <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        تغيّرت كلمة المرور، وأُبطلت الجلسات كلها. جارٍ تحويلك إلى صفحة الدخول…
      </p>
    );
  }

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    current.length > 0 &&
    next.length >= 12 &&
    !mismatch &&
    (useRecovery ? recoveryCode.trim().length >= 8 : /^\d{6}$/.test(totp)) &&
    !mutation.isPending;

  return (
    <div className="space-y-4 text-sm">
      {banner && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          {banner}
        </div>
      )}

      <div className="grid max-w-md gap-3">
        <Input
          label="كلمة المرور الحالية"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          label="الكلمة الجديدة (١٢ حرفاً فأكثر)"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Input
          label="تأكيد الكلمة الجديدة"
          type="password"
          autoComplete="new-password"
          value={confirm}
          error={mismatch ? 'الكلمتان غير متطابقتين' : undefined}
          onChange={(e) => setConfirm(e.target.value)}
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
            label="الرمز من تطبيق المصادقة"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="******"
            className="font-mono tracking-widest"
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
          />
        )}

        <button
          type="button"
          onClick={() => setUseRecovery((v) => !v)}
          className="justify-self-start text-sm text-brand-600 underline"
        >
          {useRecovery ? 'استعمال رمز المصادقة بدلاً منه' : 'فقدتُ جهازي — استعمال رمز استرداد'}
        </button>

        <Button
          onClick={() => {
            setBanner(null);
            mutation.mutate();
          }}
          disabled={!canSubmit}
        >
          {mutation.isPending ? 'جارٍ التغيير…' : 'تغيير كلمة المرور'}
        </Button>
      </div>
    </div>
  );
}
