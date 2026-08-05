'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import QRCode from 'qrcode';
import { Button, Input } from '@/components/ui';

export interface TotpSetupResponse {
  secret: string;
  otpauthUrl: string;
}

export interface TotpEnrollProps {
  setup: TotpSetupResponse;
  submitting: boolean;
  error: string | null;
  /** يُستدعى برمز من 6 أرقام بعد مسح الباركود */
  onConfirm: (code: string) => void;
}

/**
 * خطوتا تسجيل جهاز المصادقة: مسح الباركود (أو فتح التطبيق مباشرة على الهاتف،
 * أو لصق السر يدوياً)، ثم تأكيد أول رمز. مشترك بين شاشة أول دخول والإعدادات.
 */
export function TotpEnroll({ setup, submitting, error, onConfirm }: TotpEnrollProps) {
  const [qr, setQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setQr(null);
    setQrFailed(false);
    QRCode.toDataURL(setup.otpauthUrl, { width: 220, margin: 1 })
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => {
        if (alive) setQrFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [setup.otpauthUrl]);

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-5 text-sm">
      <div>
        <p className="mb-2 font-medium">١ — امسح الباركود بتطبيق المصادقة</p>
        <p className="mb-3 text-zinc-500">
          افتح Google Authenticator أو Microsoft Authenticator أو ما يماثله، ثم امسح هذا الرمز.
        </p>
        <div className="flex flex-col items-center gap-3 rounded-card border border-zinc-200 bg-white p-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- data: URI مولّد محلياً
            <img src={qr} alt="رمز QR لتسجيل المصادقة الثنائية" width={220} height={220} />
          ) : qrFailed ? (
            <p className="text-xs text-red-600">
              تعذّر توليد الباركود — استخدم السر اليدوي أدناه.
            </p>
          ) : (
            <div className="h-[220px] w-[220px] animate-pulse rounded-lg bg-zinc-100" />
          )}

          <a
            href={setup.otpauthUrl}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-center font-medium text-white transition hover:bg-brand-700"
          >
            فتح تطبيق المصادقة مباشرة
          </a>
          <p className="text-xs text-zinc-400">
            الزر يعمل عند فتح اللوحة من الهاتف؛ من الحاسوب امسح الباركود.
          </p>
        </div>
      </div>

      <details className="rounded-lg border border-zinc-200 bg-surface-muted/60 px-3 py-2">
        <summary className="cursor-pointer text-zinc-600">
          لا يمكنك المسح؟ أدخل السر يدوياً
        </summary>
        <div className="mt-2 flex items-center gap-2">
          <code className="grow break-all rounded-lg bg-white px-3 py-2 font-mono text-xs" dir="ltr">
            {setup.secret}
          </code>
          <Button variant="secondary" size="sm" onClick={() => void copySecret()}>
            {copied ? 'نُسخ' : 'نسخ'}
          </Button>
        </div>
      </details>

      <div>
        <p className="mb-2 font-medium">٢ — أدخل الرمز الظاهر في التطبيق</p>
        <div className="flex items-end gap-2">
          <div className="w-40">
            <Input
              label="رمز من ٦ أرقام"
              value={code}
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
            />
          </div>
          <Button
            variant="primary"
            disabled={code.length !== 6}
            loading={submitting}
            onClick={() => onConfirm(code)}
          >
            تفعيل
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
