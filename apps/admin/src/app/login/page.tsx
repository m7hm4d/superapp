'use client';

import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@superapp/api-client';
import { Button, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth';

/** A-01 دخول آمن: بريد + كلمة مرور، وحقل TOTP يظهر عند طلبه من الخادم. */

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'البريد أو كلمة المرور غير صحيحة',
  TOTP_INVALID: 'رمز التحقق غير صحيح — جرّب الرمز الحالي في تطبيق المصادقة',
  TOTP_ALREADY_USED: 'هذا الرمز استُعمل — انتظر الرمز التالي في التطبيق',
  BLOCKED: 'هذا الحساب محظور — راجع مسؤول النظام',
};

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const outcome = await login(
        email.trim(),
        password,
        totpRequired && totp ? totp : undefined,
      );
      // حساب لم يسجّل جهاز المصادقة بعد — لا جلسة إدارية قبل التسجيل
      router.replace(outcome.kind === 'enrollment' ? '/enroll' : '/overview');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'TOTP_REQUIRED') {
          setTotpRequired(true);
          setError(null);
        } else {
          setError(ERROR_MESSAGES[err.code] ?? 'تعذر تسجيل الدخول — حاول مجدداً');
        }
      } else {
        setError('تعذر الاتصال بالخادم — تأكد من الشبكة وحاول مجدداً');
      }
      setLoading(false);
      return;
    }
    // نجاح: نُبقي حالة التحميل حتى اكتمال التحويل
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white">
            <ShieldCheck size={24} aria-hidden />
          </span>
          <h1 className="text-xl font-bold text-zinc-900">لوحة الإدارة</h1>
          <p className="text-sm text-zinc-500">دخول مخصص لفريق التشغيل فقط</p>
        </div>

        <form
          onSubmit={(e) => void onSubmit(e)}
          className="flex flex-col gap-4 rounded-card border border-zinc-200 bg-white p-6 shadow-sm"
        >
          <Input
            label="البريد الإلكتروني"
            type="email"
            dir="ltr"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@example.com"
          />
          <Input
            label="كلمة المرور"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {totpRequired && (
            <Input
              label="رمز التحقق (TOTP)"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
            />
          )}
          {totpRequired && !error && (
            <p className="text-xs text-zinc-500">
              المصادقة الثنائية مفعّلة — أدخل الرمز من تطبيق المصادقة
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" loading={loading} className="w-full">
            تسجيل الدخول
          </Button>
        </form>
      </div>
    </main>
  );
}
