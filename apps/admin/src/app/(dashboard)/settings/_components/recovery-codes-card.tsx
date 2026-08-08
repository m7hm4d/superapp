'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { authErrorAr } from '@/lib/auth-errors';
import { Button, Input } from '@/components/ui';
import { copyText } from '@/lib/copy';

/**
 * رموز استرداد المصادقة الثنائية.
 *
 * الهاتف الضائع كان يعني تعديلاً يدوياً في قاعدة البيانات — وتلك هي النافذة
 * التي تُدفع الفرق فيها إلى تعطيل العامل الثاني كلّه.
 */
export function RecoveryCodesCard() {
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'failed'>('idle');

  const statusQuery = useQuery({
    queryKey: ['recovery', 'status'],
    queryFn: () => api.get<{ remaining: number }>('auth/admin/recovery-codes'),
  });

  const mutation = useMutation({
    mutationFn: () => api.post<{ codes: string[] }>('auth/admin/recovery-codes', { password, totp }),
    onSuccess: (res) => {
      setCodes(res.codes);
      setPassword('');
      setTotp('');
      setBanner(null);
      void statusQuery.refetch();
    },
    onError: (e) => setBanner(authErrorAr(e)),
  });

  // العرض مرة واحدة: لا تُخزَّن نصّاً على الخادم فلا سبيل إلى إظهارها ثانيةً
  if (codes) {
    return (
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          تُعرض مرة واحدة. اطبعها أو احفظها الآن — لا تُخزَّن على الخادم نصّاً، ولا
          يمكن إظهارها مجدداً. وتوليد مجموعة جديدة يُبطل هذه.
        </div>

        <ul className="grid gap-1 rounded-lg border border-zinc-300 bg-zinc-50 p-4 font-mono sm:grid-cols-2">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              setCopyState((await copyText(codes.join('\n'))) ? 'ok' : 'failed');
            }}
          >
            {copyState === 'ok' ? 'نُسخت ✓' : 'نسخ'}
          </Button>

          {/* تنزيل: المخرج الوحيد لمن منعه المتصفح من النسخ */}
          <Button
            variant="secondary"
            onClick={() => {
              const blob = new Blob([`رموز استرداد SuperApp\n\n${codes.join('\n')}\n`], {
                type: 'text/plain;charset=utf-8',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'superapp-recovery-codes.txt';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            تنزيل ملفاً
          </Button>

          <Button onClick={() => setCodes(null)}>حفظتُها — إخفاء</Button>
        </div>

        {copyState === 'failed' && (
          <p className="text-red-700">
            منع المتصفح النسخ — نزّلها ملفاً أو حدّدها بالمؤشّر وانسخها يدوياً.
          </p>
        )}
      </div>
    );
  }

  const remaining = statusQuery.data?.remaining ?? 0;
  const canSubmit = password.length > 0 && /^\d{6}$/.test(totp) && !mutation.isPending;

  return (
    <div className="space-y-4 text-sm">
      {banner && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          {banner}
        </div>
      )}

      {/* حالة الاستعلام تُميَّز عن نتيجته: سقوطه كان يُقرأ صفراً فتقول
          البطاقة «لا رموز لديك» — دعوى كاذبة واثقة، وهي أسوأ من الصمت.
          ورأى المستخدم هذا فعلاً بعد تغيير كلمة المرور: ماتت جلسته فسقط
          الاستعلام، فأُخبر أنه بلا رموز وهو يملك تسعة. */}
      {statusQuery.isPending ? (
        <p className="text-zinc-500">جارٍ التحميل…</p>
      ) : statusQuery.isError ? (
        <p className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-zinc-700">
          تعذّرت قراءة عدد رموزك.{' '}
          <button
            type="button"
            onClick={() => void statusQuery.refetch()}
            className="text-brand-600 underline"
          >
            إعادة المحاولة
          </button>
        </p>
      ) : remaining === 0 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          لا رموز لديك. لو ضاع هاتفك الآن لتعذّر دخولك — ولّد مجموعة.
        </p>
      ) : remaining <= 3 ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
          بقي {remaining} فقط — ولّد مجموعة جديدة.
        </p>
      ) : (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800">
          لديك <strong>{remaining}</strong> من ١٠ رموز صالحة.
        </p>
      )}

      <div className="grid max-w-md gap-3">
        <Input
          label="كلمة المرور"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
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
        <Button
          onClick={() => {
            setBanner(null);
            mutation.mutate();
          }}
          disabled={!canSubmit}
        >
          {mutation.isPending
            ? 'جارٍ التوليد…'
            : remaining > 0
              ? 'توليد مجموعة جديدة (تُبطل الحالية)'
              : 'توليد الرموز'}
        </Button>
      </div>
    </div>
  );
}
