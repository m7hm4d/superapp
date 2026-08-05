'use client';

import { useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import { formatDate, formatTime } from '@superapp/i18n';
import { api } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Input,
  KpiCard,
  PageHeader,
  Select,
  Skeleton,
} from '@/components/ui';

interface AuthEventRow {
  id: string;
  userId: string | null;
  fullName: string | null;
  role: string | null;
  method: string;
  outcome: string;
  sessionFamilyId: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface SessionRow {
  familyId: string;
  userId: string;
  fullName: string;
  role: string;
  phone: string;
  startedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
}

interface Summary {
  since: string;
  successCount: number;
  failureCount: number;
  activeSessions: number;
  distinctIps: number;
}

interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 50;

const OUTCOME_AR: Record<string, { label: string; tone: 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'purple' }> = {
  success: { label: 'دخول ناجح', tone: 'green' },
  invalid_credentials: { label: 'كلمة مرور خاطئة', tone: 'red' },
  unknown_identifier: { label: 'حساب غير موجود', tone: 'red' },
  totp_required: { label: 'طُلب رمز التحقق', tone: 'gray' },
  totp_invalid: { label: 'رمز تحقق خاطئ', tone: 'red' },
  totp_replayed: { label: 'رمز مُستعمَل سلفاً', tone: 'red' },
  enrollment_required: { label: 'يحتاج تسجيل جهاز', tone: 'amber' },
  enrollment_completed: { label: 'سجّل جهاز مصادقة', tone: 'blue' },
  blocked: { label: 'حساب محظور', tone: 'red' },
  admin_login_denied: { label: 'أدمن حاول من مسار الهاتف', tone: 'red' },
  refresh_reuse: { label: 'إعادة استخدام توكن', tone: 'red' },
  logout: { label: 'خروج', tone: 'gray' },
  session_revoked: { label: 'قُطعت الجلسة', tone: 'purple' },
};

const METHOD_AR: Record<string, string> = {
  phone_password: 'هاتف + كلمة مرور',
  admin_password_totp: 'لوحة الإدارة (2FA)',
  refresh: 'تجديد توكن',
  logout: 'خروج',
  admin_action: 'إجراء إداري',
};

const ROLE_AR: Record<string, string> = {
  customer: 'زبون',
  vendor: 'متجر',
  driver: 'سائق',
  admin: 'إدارة',
};

const OUTCOME_OPTIONS = [
  { value: '', label: 'كل النتائج' },
  ...Object.entries(OUTCOME_AR).map(([value, v]) => ({ value, label: v.label })),
];

function arError(e: unknown): string {
  if (e instanceof ApiError) return `تعذر تنفيذ العملية (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

/** متصفح/نظام مختصر من user-agent — يكفي لتمييز الأجهزة دون عرض السلسلة كاملة */
function deviceLabel(ua: string | null): string {
  if (!ua) return '—';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /okhttp|Expo|ReactNative/i.test(ua) ? 'تطبيق الجوال'
    : 'متصفح آخر';
  const os =
    /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return os ? `${browser} — ${os}` : browser;
}

function when(value: string): string {
  return `${formatDate(value)} — ${formatTime(value)}`;
}

export default function SecurityPage() {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState('');
  const [userId, setUserId] = useState('');
  const [offset, setOffset] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const userFilter = userId.trim().length === 36 ? { userId: userId.trim() } : {};

  const summaryQuery = useQuery({
    queryKey: ['auth-events', 'summary'],
    queryFn: () => api.get<Summary>('admin/auth-events/summary'),
  });

  const sessionsQuery = useQuery({
    queryKey: ['sessions', userFilter],
    queryFn: () => api.get<Paginated<SessionRow>>('admin/sessions', { ...userFilter, limit: 100, offset: 0 }),
  });

  const eventsFilters = { ...userFilter, ...(outcome ? { outcome } : {}), limit: PAGE_SIZE, offset };
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
  const total = eventsQuery.data?.total ?? 0;

  return (
    <div>
      <PageHeader
        title="الدخول والجلسات"
        description="سجل محاولات الدخول والأجهزة المتصلة حالياً — يمكن قطع أي جلسة فوراً"
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
      ) : summary ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="جلسات نشطة الآن" value={String(summary.activeSessions)} />
          <KpiCard label="دخول ناجح (٢٤ ساعة)" value={String(summary.successCount)} tone="success" />
          <KpiCard
            label="محاولات فاشلة (٢٤ ساعة)"
            value={String(summary.failureCount)}
            tone={summary.failureCount > 20 ? 'danger' : 'default'}
          />
          <KpiCard label="عناوين مختلفة (٢٤ ساعة)" value={String(summary.distinctIps)} />
        </div>
      ) : null}

      <div className="mt-8">
        <Card title="الجلسات النشطة">
          {sessionsQuery.isError ? (
            <ErrorState message="تعذر تحميل الجلسات" onRetry={() => void sessionsQuery.refetch()} />
          ) : (
            <DataTable<SessionRow>
              loading={sessionsQuery.isPending}
              empty="لا توجد جلسات نشطة"
              rows={sessionsQuery.data?.items ?? []}
              rowKey={(row) => row.familyId}
              columns={[
                { key: 'user', header: 'المستخدم', render: (row) => row.fullName },
                {
                  key: 'role',
                  header: 'الدور',
                  render: (row) => <Badge tone="gray">{ROLE_AR[row.role] ?? row.role}</Badge>,
                },
                { key: 'device', header: 'الجهاز', render: (row) => deviceLabel(row.userAgent) },
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
                  render: (row) => <span className="text-gray-500">{when(row.lastSeenAt)}</span>,
                },
                {
                  key: 'started',
                  header: 'بدأت',
                  render: (row) => <span className="text-gray-500">{when(row.startedAt)}</span>,
                },
                {
                  key: 'actions',
                  header: '',
                  render: (row) => (
                    <Button variant="danger" size="sm" onClick={() => setRevokeTarget(row)}>
                      قطع الجلسة
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Card>
      </div>

      <div className="mt-8">
        <Card
          title="سجل عمليات الدخول"
          actions={
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-72">
                <Input
                  placeholder="تصفية بمعرّف المستخدم (UUID)"
                  value={userId}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setUserId(e.target.value);
                    setOffset(0);
                  }}
                />
              </div>
              <div className="w-56">
                <Select
                  options={OUTCOME_OPTIONS}
                  value={outcome}
                  onChange={(v: string) => {
                    setOutcome(v);
                    setOffset(0);
                  }}
                />
              </div>
            </div>
          }
        >
          {eventsQuery.isError ? (
            <ErrorState message="تعذر تحميل السجل" onRetry={() => void eventsQuery.refetch()} />
          ) : (
            <>
              <DataTable<AuthEventRow>
                loading={eventsQuery.isPending}
                empty="لا توجد أحداث مطابقة"
                rows={eventsQuery.data?.items ?? []}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: 'when',
                    header: 'الوقت',
                    render: (row) => <span className="text-gray-500">{when(row.createdAt)}</span>,
                  },
                  {
                    key: 'user',
                    header: 'المستخدم',
                    render: (row) =>
                      row.fullName ?? <span className="text-gray-400">غير معروف</span>,
                  },
                  {
                    key: 'role',
                    header: 'الدور',
                    render: (row) => (row.role ? ROLE_AR[row.role] ?? row.role : '—'),
                  },
                  {
                    key: 'outcome',
                    header: 'النتيجة',
                    render: (row) => {
                      const o = OUTCOME_AR[row.outcome] ?? { label: row.outcome, tone: 'gray' as const };
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
                  { key: 'device', header: 'الجهاز', render: (row) => deviceLabel(row.userAgent) },
                ]}
              />

              <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
                <span>
                  {total} حدث — يظهر {Math.min(offset + 1, total)}–
                  {Math.min(offset + PAGE_SIZE, total)}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    السابق
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={offset + PAGE_SIZE >= total}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    التالي
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        title="قطع الجلسة"
        body={
          revokeTarget
            ? `ستُبطل جلسة ${revokeTarget.fullName} على ${deviceLabel(revokeTarget.userAgent)}. سيحتاج إلى تسجيل الدخول من جديد خلال دقائق (حتى انتهاء توكن الوصول الحالي).`
            : undefined
        }
        danger
        confirmLabel="تأكيد القطع"
        onConfirm={async () => {
          if (!revokeTarget) return;
          await revokeMutation.mutateAsync(revokeTarget.familyId);
        }}
      />
    </div>
  );
}
