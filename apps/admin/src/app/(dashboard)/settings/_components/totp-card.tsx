'use client';

import { useState, type ChangeEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import { api } from '@/lib/api';
import { Button, Input } from '@/components/ui';

interface TotpSetupResponse {
  secret: string;
  otpauthUrl: string;
}

const ERROR_AR: Record<string, string> = {
  INVALID_TOTP: 'الرمز غير صحيح — تأكد من تطبيق المصادقة وحاول مجدداً',
  TOTP_NOT_SETUP: 'ابدأ بالإعداد أولاً ثم أدخل الرمز',
  VALIDATION_ERROR: 'أدخل رمزاً من 6 أرقام',
};

function arError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر تنفيذ العملية (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

export function TotpCard() {
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const setupMutation = useMutation({
    mutationFn: () => api.post<TotpSetupResponse>('auth/admin/totp/setup'),
    onSuccess: (data) => {
      setBanner(null);
      setEnabled(false);
      setCode('');
      setSetup(data);
    },
    onError: (e) => setBanner(arError(e)),
  });

  const enableMutation = useMutation({
    mutationFn: (totp: string) => api.post('auth/admin/totp/enable', { totp }),
    onSuccess: () => {
      setBanner(null);
      setEnabled(true);
    },
    onError: (e) => setBanner(arError(e)),
  });

  const copySecret = async () => {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setBanner('تعذر النسخ — انسخ السر يدوياً');
    }
  };

  if (enabled) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-800">
        فُعّلت المصادقة الثنائية بنجاح. ستُطلب منك رموز TOTP في كل تسجيل دخول قادم.
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {banner && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">
          {banner}
        </div>
      )}

      {!setup ? (
        <>
          <p className="text-gray-600">
            المصادقة الثنائية (TOTP) تضيف طبقة حماية لحساب المشرف — مطلوبة قبل الإطلاق.
          </p>
          <Button
            variant="primary"
            loading={setupMutation.isPending}
            onClick={() => setupMutation.mutate()}
          >
            إعداد المصادقة الثنائية
          </Button>
        </>
      ) : (
        <>
          <div>
            <p className="mb-1 font-medium">1 — أضف هذا السر إلى تطبيق المصادقة</p>
            <p className="text-gray-500">
              في Google Authenticator أو ما يماثله اختر «إدخال مفتاح يدوياً» والصق السر:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code
                className="grow break-all rounded-lg bg-gray-100 px-3 py-2 font-mono text-xs"
                dir="ltr"
              >
                {setup.secret}
              </code>
              <Button variant="secondary" size="sm" onClick={() => void copySecret()}>
                {copied ? 'نُسخ' : 'نسخ'}
              </Button>
            </div>
            <p className="mt-2 break-all font-mono text-xs text-gray-400" dir="ltr">
              {setup.otpauthUrl}
            </p>
          </div>

          <div>
            <p className="mb-2 font-medium">2 — أدخل أول رمز يظهر في التطبيق</p>
            <div className="flex items-end gap-2">
              <div className="w-40">
                <Input
                  label="رمز من 6 أرقام"
                  value={code}
                  dir="ltr"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                />
              </div>
              <Button
                variant="primary"
                disabled={code.length !== 6}
                loading={enableMutation.isPending}
                onClick={() => enableMutation.mutate(code)}
              >
                تفعيل
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
