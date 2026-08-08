'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ConfirmDialog, ErrorState, KpiCard, PageHeader, Skeleton } from '@/components/ui';
import { AuthLogCard, FAILED_FILTER, PAGE_SIZE } from './_components/auth-log-card';
import { deviceLabel } from './_components/device';
import { SessionsCard } from './_components/sessions-card';
import type { AuthEventRow, LogFilters, Paginated, SessionRow } from './_components/types';

interface Summary {
  since: string;
  successCount: number;
  failureCount: number;
  activeSessions: number;
  distinctIps: number;
}

function arError(e: unknown): string {
  if (e instanceof ApiError) return `تعذر تنفيذ العملية (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

export default function SecurityPage() {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState('');
  const [userId, setUserId] = useState('');
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // كل تغيير في التصفية يعيد الترقيم إلى أوّله: البقاء على الصفحة الثالثة
  // بعد تضييق النتائج يُظهر جدولاً فارغاً ويُقرأ «لا شيء هنا».
  const filters: LogFilters = useMemo(
    () => ({
      outcome,
      userId,
      userLabel,
      offset,
      setOutcome: (v) => {
        setOutcome(v);
        setOffset(0);
      },
      setUser: (id, label) => {
        setUserId(id);
        setUserLabel(label);
        setOffset(0);
      },
      clearUser: () => {
        setUserId('');
        setUserLabel(null);
        setOffset(0);
      },
      clearAll: () => {
        setOutcome('');
        setUserId('');
        setUserLabel(null);
        setOffset(0);
      },
      setOffset,
    }),
    [outcome, userId, userLabel, offset],
  );

  const userFilter = userId.length === 36 ? { userId } : {};

  const summaryQuery = useQuery({
    queryKey: ['auth-events', 'summary'],
    queryFn: () => api.get<Summary>('admin/auth-events/summary'),
  });

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () =>
      api.get<Paginated<SessionRow>>('admin/sessions', {
        limit: 100,
        offset: 0,
      }),
  });

  const eventsFilters = {
    ...userFilter,
    ...(outcome ? { outcome } : {}),
    limit: PAGE_SIZE,
    offset,
  };
  const eventsQuery = useQuery({
    queryKey: ['auth-events', eventsFilters],
    queryFn: () => api.get<Paginated<AuthEventRow>>('admin/auth-events', eventsFilters),
  });

  const revokeMutation = useMutation({
    mutationFn: (familyId: string) => api.post(`admin/sessions/${familyId}/revoke`, {}),
    onSuccess: () => {
      setBanner(null);
      setRevokeTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['auth-events'] });
    },
    onError: (e) => setBanner(arError(e)),
  });

  const summary = summaryQuery.data;
  const failuresActive = outcome === FAILED_FILTER;

  return (
    <div>
      <PageHeader
        title="الدخول والجلسات"
        description="من يدخل، ومن هو متصل الآن — ويمكن قطع أي جلسة فوراً"
      />

      {banner && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {banner}
        </div>
      )}

      {summaryQuery.isPending ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : summaryQuery.isError ? (
        <ErrorState message="تعذر تحميل الملخص" onRetry={() => void summaryQuery.refetch()} />
      ) : summary ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="جلسات نشطة الآن" value={String(summary.activeSessions)} />
          <KpiCard
            label="دخول ناجح (٢٤ ساعة)"
            value={String(summary.successCount)}
            tone="success"
          />
          {/* الرقم الذي يقلق المشرف يجب أن يقوده إلى صفوفه، لا أن يتركه
              يبحث في قائمة منسدلة فيها ثلاثة عشر خياراً. */}
          <button
            type="button"
            onClick={() => {
              filters.setOutcome(failuresActive ? '' : FAILED_FILTER);
              document.getElementById('auth-log')?.scrollIntoView({ behavior: 'smooth' });
            }}
            aria-pressed={failuresActive}
            className={cn(
              'block h-full w-full rounded-card text-start transition',
              failuresActive
                ? 'ring-2 ring-red-400 ring-offset-2'
                : 'hover:-translate-y-0.5 hover:shadow-md',
            )}
          >
            <KpiCard
              label="محاولات فاشلة (٢٤ ساعة)"
              value={String(summary.failureCount)}
              hint={failuresActive ? 'السجل مُصفّى بها — اضغط للإلغاء' : 'اضغط لعرضها في السجل'}
              tone={summary.failureCount > 20 ? 'danger' : 'default'}
            />
          </button>
          <KpiCard label="عناوين مختلفة (٢٤ ساعة)" value={String(summary.distinctIps)} />
        </div>
      ) : null}

      <div className="mt-8">
        <SessionsCard
          sessions={sessionsQuery.data?.items ?? []}
          total={sessionsQuery.data?.total ?? 0}
          isPending={sessionsQuery.isPending}
          isError={sessionsQuery.isError}
          onRetry={() => void sessionsQuery.refetch()}
          onRevoke={setRevokeTarget}
          onFilterUser={(id, label) => {
            filters.setUser(id, label);
            document.getElementById('auth-log')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      </div>

      <div className="mt-8" id="auth-log">
        <AuthLogCard
          filters={filters}
          data={eventsQuery.data}
          isPending={eventsQuery.isPending}
          isError={eventsQuery.isError}
          onRetry={() => void eventsQuery.refetch()}
        />
      </div>

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title={revokeTarget?.isCurrent ? 'إنهاء جلستك أنت' : 'قطع الجلسة'}
        body={
          revokeTarget
            ? revokeTarget.isCurrent
              ? // القطع صار فورياً منذ أن صار الحارس يفحص العائلة في كل طلب،
                // فمن يقطع جلسته يخرج الآن لا بعد دقائق — والتحذير يقول ذلك.
                `هذه جلستك على ${deviceLabel(revokeTarget.userAgent)}. ستخرج من اللوحة فوراً وتحتاج إلى تسجيل الدخول من جديد.`
              : `ستُبطل جلسة ${revokeTarget.fullName} على ${deviceLabel(revokeTarget.userAgent)} فوراً، وسيحتاج إلى تسجيل الدخول من جديد.`
            : undefined
        }
        danger
        confirmLabel={revokeTarget?.isCurrent ? 'نعم، أنهِ جلستي' : 'تأكيد القطع'}
        onConfirm={async () => {
          if (!revokeTarget) return;
          await revokeMutation.mutateAsync(revokeTarget.familyId);
        }}
      />
    </div>
  );
}
