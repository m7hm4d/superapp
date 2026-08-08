'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import { api } from '@/lib/api';
import { formatFullDateTime, formatRelative } from '@/lib/format';
import { Badge, Button, Card, ConfirmDialog, DataTable, ErrorState } from '@/components/ui';
import { DeviceAvatar, DeviceCell, deviceLabel } from './device';
import { ROLE_AR, type SessionRow } from './types';

export interface SessionsCardProps {
  sessions: SessionRow[];
  /** العدد الكلي على الخادم — الصفحة تحمل جزءاً منه */
  total: number;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  /** فتح حوار القطع لصفّ واحد — الحوار في الصفحة كي يبقى نصّه في مكان واحد */
  onRevoke: (row: SessionRow) => void;
  /** الضغط على اسم يُصفّي سجل الدخول به */
  onFilterUser: (userId: string, label: string) => void;
}

/** ما يُعرض قبل الضغط على «عرض الكل» */
const COLLAPSED_ROWS = 8;

/** «جلستان» و«٣ جلسات» و«١٢ جلسة» — العربية لا تُجمع بلاحقة واحدة. */
function sessionsCount(n: number): string {
  if (n === 1) return 'جلسة أخرى واحدة';
  if (n === 2) return 'جلستان أخريان';
  if (n <= 10) return `${n} جلسات أخرى`;
  return `${n} جلسة أخرى`;
}

/**
 * الجلسات النشطة: جلستك أولاً ثم البقية.
 *
 * كانت الجلسات كلها صفوفاً متساوية في جدول واحد، فسأل المستخدم هذا السؤال
 * حرفياً: «ماهو رمز الجهاز الحالي؟». والشارة وحدها لم تكفِ لأنها تُقرأ داخل
 * صفّ يشبه ما حوله. فجلستك تخرج من الجدول إلى بطاقة فوقه — تُرى قبل أن
 * تُقرأ، وهو ما تفعله GitHub وLinear وAirwallex.
 */
export function SessionsCard({
  sessions,
  total,
  isPending,
  isError,
  onRetry,
  onRevoke,
  onFilterUser,
}: SessionsCardProps) {
  const queryClient = useQueryClient();
  const [bulkOpen, setBulkOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const current = sessions.find((s) => s.isCurrent) ?? null;
  const others = sessions.filter((s) => !s.isCurrent);
  // تسعة وتسعون صفّاً تدفع سجلّ الدخول أسفل شاشتين من التمرير، ولا أحد يقرأ
  // تسعة وتسعين جلسة متشابهة. تُعرض الأحدث، والبقية عند الطلب — كما في
  // Airwallex وGemini.
  const shown = expanded ? others : others.slice(0, COLLAPSED_ROWS);
  // «كل الجلسات الأخرى» في لوحة تعرض جلسات النظام كلّه تعني قطع السائقين
  // والمتاجر والزبائن معاً — وليس ذلك ما يقصده من يضغطها. فالزرّ محصور
  // بجلساتك أنت، وهي وحدها ما يملك المشرف قراراً شخصياً فيها.
  const mineElsewhere = current ? others.filter((s) => s.userId === current.userId) : [];

  const bulkRevoke = useMutation({
    mutationFn: async () => {
      let ok = 0;
      let failed = 0;
      // بالتتابع لا بالتوازي: كل قطع يكتب حدثاً وسطراً في سجل التدقيق،
      // ودفعها معاً يخلط ترتيبها في السجل الذي سيُقرأ لاحقاً.
      for (const session of mineElsewhere) {
        try {
          await api.post(`admin/sessions/${session.familyId}/revoke`, {});
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      setNotice(
        failed === 0
          ? `أُنهيت ${ok} من جلساتك الأخرى.`
          : `أُنهيت ${ok} جلسة، وتعذّر إنهاء ${failed} — أعد المحاولة.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['auth-events'] });
    },
    onError: (e) =>
      setNotice(e instanceof ApiError ? `تعذر التنفيذ (${e.code})` : 'حدث خطأ غير متوقع'),
  });

  return (
    <Card
      title="الجلسات النشطة"
      actions={
        mineElsewhere.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={() => setBulkOpen(true)}>
            إنهاء جلساتي الأخرى ({mineElsewhere.length})
          </Button>
        ) : undefined
      }
    >
      {isError ? (
        <ErrorState message="تعذر تحميل الجلسات" onRetry={onRetry} />
      ) : (
        <>
          {notice && (
            <div className="mb-4 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              {notice}
            </div>
          )}

          {current && (
            <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <DeviceAvatar
                    ua={current.userAgent}
                    className="text-emerald-700 ring-emerald-200"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                      />
                      <span className="font-semibold text-zinc-900">
                        {deviceLabel(current.userAgent)}
                      </span>
                      <Badge tone="green">جلستك الحالية</Badge>
                    </div>
                    <p className="mt-1 text-sm text-zinc-600">
                      {current.fullName} ·{' '}
                      <span dir="ltr" className="font-mono text-xs">
                        {current.ip ?? '—'}
                      </span>{' '}
                      · بدأت{' '}
                      <span title={formatFullDateTime(current.startedAt)}>
                        {formatRelative(current.startedAt)}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      هذا هو الجهاز الذي تقرأ منه الآن — إنهاؤه يُخرجك فوراً.
                    </p>
                  </div>
                </div>

                <Button variant="secondary" size="sm" onClick={() => onRevoke(current)}>
                  إنهاء جلستي
                </Button>
              </div>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold text-zinc-700">
              {isPending
                ? 'الجلسات الأخرى'
                : others.length === 0
                  ? 'لا جلسات أخرى'
                  : sessionsCount(others.length)}
            </h3>
            {/* الصفحة تحمل جزءاً من العدد الحيّ — والعنوان الذي يقول «٩٩ جلسة»
                عن ٣٨٧ دعوى كاذبة، فيُقال الفرق صراحةً. */}
            {!isPending && total > sessions.length && (
              <span className="text-xs text-zinc-500">
                حُمّلت أحدث {sessions.length} من {total} جلسة نشطة
              </span>
            )}
          </div>

          <DataTable<SessionRow>
            loading={isPending}
            empty={current ? 'لا أحد متصل غيرك الآن' : 'لا توجد جلسات نشطة'}
            rows={shown}
            rowKey={(row) => row.familyId}
            columns={[
              {
                key: 'user',
                header: 'المستخدم',
                render: (row) => (
                  // الاسم مدخل إلى سجل هذا المستخدم: كان المشرف ينسخ UUID
                  // من مكان آخر ويلصقه في حقل تصفية ليرى ما فعله هذا الحساب.
                  <button
                    type="button"
                    onClick={() => onFilterUser(row.userId, row.fullName)}
                    className="rounded text-start font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 transition hover:decoration-brand-500"
                    title="عرض سجل دخول هذا المستخدم"
                  >
                    {row.fullName}
                  </button>
                ),
              },
              {
                key: 'role',
                header: 'الدور',
                render: (row) => <Badge tone="gray">{ROLE_AR[row.role] ?? row.role}</Badge>,
              },
              {
                key: 'device',
                header: 'الجهاز',
                render: (row) => <DeviceCell ua={row.userAgent} />,
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
                key: 'last',
                header: 'آخر نشاط',
                // الوقت النسبي يُقرأ بلمحة، والمطلق يبقى في التلميح لمن يحقق
                render: (row) => (
                  <span
                    className="whitespace-nowrap text-zinc-500"
                    title={`آخر نشاط: ${formatFullDateTime(row.lastSeenAt)}\nبدأت: ${formatFullDateTime(row.startedAt)}\nتنتهي: ${formatFullDateTime(row.expiresAt)}`}
                  >
                    {formatRelative(row.lastSeenAt)}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <Button variant="danger" size="sm" onClick={() => onRevoke(row)}>
                    قطع الجلسة
                  </Button>
                ),
              },
            ]}
          />

          {others.length > COLLAPSED_ROWS && (
            <div className="mt-3 text-center">
              <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
                {expanded ? 'عرض أقل' : `عرض الباقي (${others.length - COLLAPSED_ROWS})`}
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="إنهاء جلساتك الأخرى"
        body={`ستُبطل ${mineElsewhere.length} جلسة أخرى لحسابك على أجهزة غير هذا الجهاز. جلستك الحالية تبقى مفتوحة.`}
        danger
        confirmLabel="نعم، أنهِها"
        onConfirm={async () => {
          setNotice(null);
          await bulkRevoke.mutateAsync();
        }}
      />
    </Card>
  );
}
