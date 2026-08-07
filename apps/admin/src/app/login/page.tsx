'use client';

import { KeyRound, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '@superapp/api-client';
import { Button, Input } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { loginWithPasskey, passkeySupported } from '@/lib/passkey';

/**
 * A-01 دخول آمن على خطوتين.
 *
 * كلمة المرور أولاً دائماً، ثم عامل ثانٍ يختاره الأدمن: رمز التطبيق أو مفتاح
 * المرور. المفتاح **بديل عن الرمز لا عن كلمة المرور** — فمفتاح متزامن على
 * جهاز مسروق مفتوح لا يفتح اللوحة وحده.
 */

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'البريد أو كلمة المرور غير صحيحة',
  PASSKEY_UNKNOWN: 'هذا المفتاح غير مسجّل في اللوحة',
  PASSKEY_MISMATCH: 'هذا المفتاح لا يخصّ هذا الحساب',
  PASSKEY_INVALID: 'تعذّر التحقق من المفتاح',
  PASSKEY_CHALLENGE_EXPIRED: 'انتهت مهلة المحاولة — أعد الضغط على الزر',
  NO_PASSKEY: 'لا مفاتيح مسجّلة على هذا الحساب',
  STEP_UP_INVALID: 'انتهت مهلة التأكيد — أعد إدخال كلمة المرور',
  TOTP_INVALID: 'رمز التحقق غير صحيح — جرّب الرمز الحالي في تطبيق المصادقة',
  TOTP_ALREADY_USED: 'هذا الرمز استُعمل — انتظر الرمز التالي في التطبيق',
  TOTP_NOT_ENABLED: 'المصادقة الثنائية غير مفعّلة على هذا الحساب',
  BLOCKED: 'هذا الحساب محظور — راجع مسؤول النظام',
};

const messageFor = (err: unknown, fallback: string): string =>
  err instanceof ApiError ? (ERROR_MESSAGES[err.code] ?? `${fallback} (${err.code})`) : fallback;

type Stage =
  | { name: 'credentials' }
  | { name: 'second_factor'; stepUpToken: string; methods: ('totp' | 'passkey')[] };

export default function LoginPage() {
  const router = useRouter();
  const { login, adoptSession } = useAuth();

  const [stage, setStage] = useState<Stage>({ name: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [browserSupportsPasskeys, setBrowserSupportsPasskeys] = useState(false);

  useEffect(() => setBrowserSupportsPasskeys(passkeySupported()), []);

  /** يعود إلى الخطوة الأولى: التوكن قصير العمر ولا يُعاد استعماله */
  function restart(message: string | null) {
    setStage({ name: 'credentials' });
    setPassword('');
    setTotp('');
    setError(message);
    setLoading(false);
    setPasskeyLoading(false);
  }

  async function onCredentials(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const outcome = await login(email.trim(), password);
      if (outcome.kind === 'enrollment') {
        router.replace('/enroll');
        return;
      }
      if (outcome.kind === 'second_factor') {
        setStage({
          name: 'second_factor',
          stepUpToken: outcome.stepUpToken,
          methods: outcome.methods,
        });
        setLoading(false);
        return;
      }
      router.replace('/overview');
    } catch (err) {
      setError(messageFor(err, 'تعذر تسجيل الدخول — حاول مجدداً'));
      setLoading(false);
    }
  }

  async function onTotp(e: FormEvent) {
    e.preventDefault();
    if (loading || stage.name !== 'second_factor') return;
    setError(null);
    setLoading(true);
    try {
      const outcome = await login(email.trim(), password, totp);
      router.replace(outcome.kind === 'enrollment' ? '/enroll' : '/overview');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STEP_UP_INVALID') {
        restart(ERROR_MESSAGES.STEP_UP_INVALID ?? null);
        return;
      }
      setError(messageFor(err, 'تعذر تسجيل الدخول — حاول مجدداً'));
      setTotp('');
      setLoading(false);
    }
  }

  async function onPasskey() {
    if (passkeyLoading || stage.name !== 'second_factor') return;
    setError(null);
    setPasskeyLoading(true);
    try {
      const res = await loginWithPasskey(stage.stepUpToken);
      await adoptSession(res.user, res.tokens);
      router.replace('/overview');
    } catch (err) {
      // إلغاء المستخدم لنافذة النظام ليس خطأً يستحق رسالة حمراء
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setPasskeyLoading(false);
        return;
      }
      if (err instanceof ApiError && err.code === 'STEP_UP_INVALID') {
        restart(ERROR_MESSAGES.STEP_UP_INVALID ?? null);
        return;
      }
      setError(messageFor(err, 'تعذّر الدخول بمفتاح المرور'));
      setPasskeyLoading(false);
    }
  }

  const canUsePasskey =
    stage.name === 'second_factor' &&
    stage.methods.includes('passkey') &&
    browserSupportsPasskeys;
  const canUseTotp = stage.name === 'second_factor' && stage.methods.includes('totp');

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

        {stage.name === 'credentials' ? (
          <form
            onSubmit={(e) => void onCredentials(e)}
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
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" loading={loading} className="w-full">
              متابعة
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4 rounded-card border border-zinc-200 bg-white p-6 shadow-sm">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">تأكيد الهوية</h2>
              <p className="mt-1 text-xs text-zinc-500">
                كلمة المرور صحيحة. أكّد بعامل ثانٍ لإتمام الدخول.
              </p>
            </div>

            {canUsePasskey && (
              <>
                <Button
                  type="button"
                  className="w-full"
                  loading={passkeyLoading}
                  onClick={() => void onPasskey()}
                >
                  <span className="flex items-center justify-center gap-2">
                    <KeyRound size={18} aria-hidden />
                    التأكيد بمفتاح المرور
                  </span>
                </Button>
                <p className="-mt-2 text-center text-xs text-zinc-500">
                  بصمة أو رمز الجهاز — أسرع، ولا يمكن تصيّده
                </p>
              </>
            )}

            {canUsePasskey && canUseTotp && (
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-zinc-200" />
                <span className="text-xs text-zinc-400">أو</span>
                <span className="h-px flex-1 bg-zinc-200" />
              </div>
            )}

            {canUseTotp && (
              <form onSubmit={(e) => void onTotp(e)} className="flex flex-col gap-3">
                <Input
                  label="رمز التحقق (TOTP)"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoFocus={!canUsePasskey}
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                />
                <Button type="submit" variant="secondary" loading={loading} className="w-full">
                  تأكيد الرمز
                </Button>
              </form>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="button"
              onClick={() => restart(null)}
              className="text-xs text-zinc-500 underline-offset-2 hover:underline"
            >
              الرجوع وتغيير الحساب
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
