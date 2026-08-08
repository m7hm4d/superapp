'use client';

import { useState, type ChangeEvent } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { formatDateTime, formatFullDateTime, formatRelative } from '@/lib/format';
import { Badge, Button, Card, DataTable, ErrorState, Input, Select } from '@/components/ui';
import type { BadgeTone } from '@/components/ui';
import { DeviceCell } from './device';
import { ROLE_AR, type AuthEventRow, type LogFilters, type Paginated } from './types';

export const PAGE_SIZE = 50;

/** أشيع إخفاق يبحث عنه المشرف — بطاقة الإخفاقات تُرشِّح به بنقرة */
export const FAILED_FILTER = 'invalid_credentials';

type Kind = 'success' | 'failure' | 'neutral';

interface OutcomeMeta {
  label: string;
  tone: BadgeTone;
  kind: Kind;
}

export const OUTCOME_AR: Record<string, OutcomeMeta> = {
  success: { label: 'دخول ناجح', tone: 'green', kind: 'success' },
  invalid_credentials: {
    label: 'كلمة مرور خاطئة',
    tone: 'red',
    kind: 'failure',
  },
  unknown_identifier: { label: 'حساب غير موجود', tone: 'red', kind: 'failure' },
  totp_required: { label: 'طُلب رمز التحقق', tone: 'gray', kind: 'neutral' },
  totp_invalid: { label: 'رمز تحقق خاطئ', tone: 'red', kind: 'failure' },
  totp_replayed: { label: 'رمز مُستعمَل سلفاً', tone: 'red', kind: 'failure' },
  enrollment_required: {
    label: 'يحتاج تسجيل جهاز',
    tone: 'amber',
    kind: 'neutral',
  },
  enrollment_completed: {
    label: 'سجّل جهاز مصادقة',
    tone: 'blue',
    kind: 'success',
  },
  blocked: { label: 'حساب محظور', tone: 'red', kind: 'failure' },
  admin_login_denied: {
    label: 'أدمن حاول من مسار الهاتف',
    tone: 'red',
    kind: 'failure',
  },
  refresh_reuse: { label: 'إعادة استخدام توكن', tone: 'red', kind: 'failure' },
  logout: { label: 'خروج', tone: 'gray', kind: 'neutral' },
  session_revoked: { label: 'قُطعت الجلسة', tone: 'purple', kind: 'neutral' },
};

const METHOD_AR: Record<string, string> = {
  phone_password: 'هاتف + كلمة مرور',
  admin_password_totp: 'لوحة الإدارة (2FA)',
  // كان ناقصاً فيُعرض `admin_passkey` خاماً في عمود عربي — ظهر في أوّل لقطة
  admin_passkey: 'لوحة الإدارة (مفتاح مرور)',
  refresh: 'تجديد توكن',
  logout: 'خروج',
  admin_action: 'إجراء إداري',
};

const OUTCOME_OPTIONS = [
  { value: '', label: 'كل النتائج' },
  ...Object.entries(OUTCOME_AR).map(([value, v]) => ({
    value,
    label: v.label,
  })),
];

const DAY_MS = 86_400_000;

/** عتبة «هذا ليس خطأً في كتابة كلمة المرور» — دون ذلك ضجيج يومي عادي. */
const BURST_THRESHOLD = 5;

function meta(outcome: string): OutcomeMeta {
  return OUTCOME_AR[outcome] ?? { label: outcome, tone: 'gray', kind: 'neutral' };
}

/**
 * أكثر عنوان تكرّرت إخفاقاته ضمن الصفحة المعروضة.
 *
 * الرقم في بطاقة «محاولات فاشلة» يقول كم، ولا يقول من أين — وهو السؤال
 * التالي مباشرةً. والحساب هنا على ما حُمِّل فقط، ولذلك تقوله الجملة صراحةً:
 * ادّعاء تغطية كامل المدة ونحن نرى خمسين صفاً منها دعوى كاذبة.
 */
function failureBurst(rows: AuthEventRow[]): { ip: string; count: number } | null {
  const byIp = new Map<string, number>();
  for (const row of rows) {
    if (meta(row.outcome).kind !== 'failure' || !row.ip) continue;
    byIp.set(row.ip, (byIp.get(row.ip) ?? 0) + 1);
  }
  let worst: { ip: string; count: number } | null = null;
  for (const [ip, count] of byIp) {
    if (count >= BURST_THRESHOLD && (worst === null || count > worst.count)) {
      worst = { ip, count };
    }
  }
  return worst;
}

/** رقاقة تصفية فعّالة — تُقرأ وتُلغى من مكانها. */
function FilterChip({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pe-1 ps-3 text-xs text-brand-800">
      <span className="text-brand-600">{label}:</span>
      <span className="font-medium">{value}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`إزالة تصفية ${label}`}
        className="rounded-full p-0.5 transition hover:bg-brand-200"
      >
        <X size={13} aria-hidden />
      </button>
    </span>
  );
}

function EventTime({ iso }: { iso: string }) {
  const recent = Date.now() - new Date(iso).getTime() < DAY_MS;
  return (
    <span className="whitespace-nowrap text-zinc-500" title={formatFullDateTime(iso)}>
      {recent ? formatRelative(iso) : formatDateTime(iso)}
    </span>
  );
}

export interface AuthLogCardProps {
  filters: LogFilters;
  data: Paginated<AuthEventRow> | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}

/**
 * سجل عمليات الدخول.
 *
 * كانت التصفية حقلاً يطلب UUID مكتوباً بخطّ اليد — وهو معرّف لا يحفظه أحد
 * ولا يُقرأ منه اسم. فصارت التصفية تُبنى بالضغط على اسم في الجدول، وتُعرض
 * رقائق تقول ما الفعّال منها الآن، وتُلغى من مكانها (نمط Circle وVanta).
 */
export function AuthLogCard({ filters, data, isPending, isError, onRetry }: AuthLogCardProps) {
  const [rawId, setRawId] = useState('');

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const burst = failureBurst(rows);
  const hasFilters = filters.outcome !== '' || filters.userId !== '';

  return (
    <Card
      title="سجل عمليات الدخول"
      actions={
        <div className="w-56">
          <Select
            options={OUTCOME_OPTIONS}
            value={filters.outcome}
            onChange={(v: string) => filters.setOutcome(v)}
          />
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {filters.outcome !== '' && (
          <FilterChip
            label="النتيجة"
            value={meta(filters.outcome).label}
            onClear={() => filters.setOutcome('')}
          />
        )}
        {filters.userId !== '' ? (
          <FilterChip
            label="المستخدم"
            value={filters.userLabel ?? `${filters.userId.slice(0, 8)}…`}
            onClear={filters.clearUser}
          />
        ) : (
          // يبقى اللصق ممكناً لمن جاء بمعرّف من تذكرة أو سجل تدقيق،
          // لكنه لم يعد الطريق الوحيد إليه.
          <div className="w-72">
            <Input
              placeholder="أو تصفية بمعرّف مستخدم (UUID)"
              value={rawId}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                setRawId(e.target.value);
                const trimmed = e.target.value.trim();
                if (trimmed.length === 36) {
                  filters.setUser(trimmed, null);
                  setRawId('');
                }
              }}
            />
          </div>
        )}
        {hasFilters && (
          <button
            type="button"
            onClick={filters.clearAll}
            className="text-xs text-zinc-500 underline underline-offset-4 transition hover:text-zinc-800"
          >
            مسح التصفية
          </button>
        )}
      </div>

      {burst && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <p>
            {burst.count} محاولة فاشلة من العنوان{' '}
            <span dir="ltr" className="font-mono text-xs">
              {burst.ip}
            </span>{' '}
            ضمن الأحداث المعروضة أدناه.
          </p>
        </div>
      )}

      {isError ? (
        <ErrorState message="تعذر تحميل السجل" onRetry={onRetry} />
      ) : (
        <>
          <DataTable<AuthEventRow>
            loading={isPending}
            empty={hasFilters ? 'لا أحداث مطابقة لهذه التصفية' : 'لا توجد أحداث بعد'}
            rows={rows}
            rowKey={(row) => row.id}
            // الإخفاق يُلمح قبل أن يُقرأ: كان يُميَّز بشارة داخل عمود واحد،
            // فيمرّ سطر أحمر بين خمسين سطراً دون أن يُوقف العين.
            rowClassName={(row) =>
              meta(row.outcome).kind === 'failure' ? 'bg-red-50/50' : undefined
            }
            columns={[
              {
                key: 'when',
                header: 'الوقت',
                render: (row) => <EventTime iso={row.createdAt} />,
              },
              {
                key: 'user',
                header: 'المستخدم',
                render: ({ userId, fullName }) => {
                  // الحدث قد يسبق وجود حساب أصلاً (معرّف مجهول) فلا اسم له
                  // ولا سجل يُصفّى به — والزرّ حينئذ وعد لا يُوفى.
                  if (!userId || !fullName) return <span className="text-zinc-400">غير معروف</span>;
                  return (
                    <button
                      type="button"
                      onClick={() => filters.setUser(userId, fullName)}
                      className="rounded text-start font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 transition hover:decoration-brand-500"
                      title="تصفية السجل بهذا المستخدم"
                    >
                      {fullName}
                    </button>
                  );
                },
              },
              {
                key: 'role',
                header: 'الدور',
                render: (row) => (row.role ? (ROLE_AR[row.role] ?? row.role) : '—'),
              },
              {
                key: 'outcome',
                header: 'النتيجة',
                render: (row) => {
                  const o = meta(row.outcome);
                  return <Badge tone={o.tone}>{o.label}</Badge>;
                },
              },
              {
                key: 'method',
                header: 'المسار',
                render: (row) => METHOD_AR[row.method] ?? row.method,
              },
              {
                key: 'ip',
                header: 'العنوان',
                render: (row) => (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.ip ?? '—'}
                  </span>
                ),
              },
              {
                key: 'device',
                header: 'الجهاز',
                render: (row) => <DeviceCell ua={row.userAgent} />,
              },
            ]}
          />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600">
            <span>
              {total === 0
                ? 'لا أحداث'
                : `${total} حدث — يظهر ${Math.min(filters.offset + 1, total)}–${Math.min(filters.offset + PAGE_SIZE, total)}`}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={filters.offset === 0}
                onClick={() => filters.setOffset(Math.max(0, filters.offset - PAGE_SIZE))}
              >
                السابق
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={filters.offset + PAGE_SIZE >= total}
                onClick={() => filters.setOffset(filters.offset + PAGE_SIZE)}
              >
                التالي
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
