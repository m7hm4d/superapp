'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';

interface TotpStatus {
  enabled: boolean;
  pending: boolean;
}

interface PasskeyRow {
  id: string;
}

/**
 * ملخّص الوضع الأمني للحساب.
 *
 * الشاشة كانت تعرض أربع بطاقات ولا تقول أيّها ناقص — فمن لم يولّد رموز
 * استرداد لا يعرف أنه لم يفعل، حتى يضيع هاتفه. والفجوة لا تُعلن عن نفسها
 * إلا في اللحظة التي لا ينفع فيها شيء.
 *
 * فيُقرأ الوضع من سطر واحد أعلى الصفحة، وتُسمّى النواقص صراحةً.
 */
export function SecurityPosture() {
  const totpQuery = useQuery({
    queryKey: ['totp', 'status'],
    queryFn: () => api.get<TotpStatus>('auth/admin/totp/status'),
  });
  const passkeysQuery = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => api.get<PasskeyRow[]>('auth/admin/passkeys'),
  });
  const recoveryQuery = useQuery({
    queryKey: ['recovery', 'status'],
    queryFn: () => api.get<{ remaining: number }>('auth/admin/recovery-codes'),
  });

  // لا يُحكم على وضع لم يُقرأ بعد: ادّعاء الأمان قبل المعرفة أسوأ من الصمت
  if (totpQuery.isPending || passkeysQuery.isPending || recoveryQuery.isPending) return null;

  const gaps: string[] = [];
  if (!totpQuery.data?.enabled && (passkeysQuery.data?.length ?? 0) === 0) {
    gaps.push('لا عامل ثانٍ مفعّل — حسابك بكلمة المرور وحدها');
  }
  if ((recoveryQuery.data?.remaining ?? 0) === 0) {
    gaps.push('لا رموز استرداد — لو ضاع جهازك لتعذّر دخولك');
  } else if ((recoveryQuery.data?.remaining ?? 0) <= 3) {
    gaps.push(`بقي ${recoveryQuery.data?.remaining} رموز استرداد فقط`);
  }

  if (gaps.length === 0) {
    return (
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold text-emerald-900">حسابك محمي</p>
          <p className="mt-0.5 text-emerald-800">
            عامل ثانٍ مفعّل، ورموز استرداد جاهزة لو ضاع جهازك.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
      <div className="text-sm">
        <p className="font-semibold text-amber-900">
          {gaps.length === 1 ? 'ينقص حسابك شيء واحد' : `ينقص حسابك ${gaps.length} أمور`}
        </p>
        <ul className="mt-1 space-y-0.5 text-amber-800">
          {gaps.map((gap) => (
            <li key={gap}>• {gap}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
