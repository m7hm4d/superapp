'use client';

import { Suspense, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import { formatDate, formatTime } from '@superapp/i18n';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Tabs,
} from '@/components/ui';

interface ExceptionRow {
  id: string;
  type: string;
  status: 'OPEN' | 'RESOLVED';
  note: string | null;
  orderId: string | null;
  orderCode: string | null;
  orderStatus: string | null;
  vendorId: string | null;
  vendorStoreNameAr: string | null;
  batchId: string | null;
  reportedByUserId: string | null;
  reporterName: string | null;
  ownerAdminId: string | null;
  decision: string | null;
  decisionReason: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface ExceptionsResponse {
  items: ExceptionRow[];
  total: number;
  limit: number;
  offset: number;
}

const STATUS_TABS = [
  { key: 'OPEN', label: 'مفتوحة' },
  { key: 'RESOLVED', label: 'محلولة' },
];

const TYPE_AR: Record<string, string> = {
  customer_unavailable: 'الزبون غير متوفر',
  address_unclear: 'العنوان غير واضح',
  customer_refused: 'رفض الاستلام',
  cash_discrepancy: 'فرق نقدي',
  vendor_issue: 'مشكلة من المتجر',
  other: 'أخرى',
};

const DECISION_OPTIONS = [
  { value: 'retry_delivery', label: 'إعادة محاولة التوصيل' },
  { value: 'cancel_order', label: 'إلغاء الطلب' },
  { value: 'mark_delivered', label: 'اعتباره مسلّماً' },
  { value: 'noted', label: 'ملاحظة فقط (إغلاق)' },
];

const DECISION_AR: Record<string, string> = {
  retry_delivery: 'إعادة محاولة التوصيل',
  cancel_order: 'إلغاء الطلب',
  mark_delivered: 'اعتُبر مسلّماً',
  noted: 'ملاحظة فقط',
};

const ERROR_AR: Record<string, string> = {
  EXCEPTION_NOT_FOUND: 'الاستثناء غير موجود',
  EXCEPTION_ALREADY_RESOLVED: 'سبق حل هذا الاستثناء',
  EXCEPTION_HAS_NO_ORDER: 'لا يرتبط هذا الاستثناء بطلب',
  NO_DRIVER_FOR_ORDER: 'لا يوجد سائق مرتبط بهذا الطلب',
  ILLEGAL_TRANSITION: 'حالة الطلب لا تسمح بهذا القرار',
  VALIDATION_ERROR: 'بيانات غير صالحة — تأكد من القرار والسبب',
};

function arError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر تنفيذ العملية (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

function ageText(value: string | null | undefined): string {
  if (!value) return '—';
  const min = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (min < 60) return `منذ ${min} د`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

function ExceptionsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('OPEN');
  const [decision, setDecision] = useState('retry_delivery');
  const [reason, setReason] = useState('');
  const [banner, setBanner] = useState<string | null>(null);

  const exceptionsQuery = useQuery({
    queryKey: ['exceptions', status],
    queryFn: () =>
      api.get<ExceptionsResponse>('admin/exceptions', { status, limit: 100, offset: 0 }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
  useSocketEvent('order:status', invalidate);
  useSocketEvent('batch:status', invalidate);

  const selectedId = searchParams.get('id');
  const selected = (exceptionsQuery.data?.items ?? []).find((r) => r.id === selectedId) ?? null;
  const closeDrawer = () => router.replace(pathname, { scroll: false });

  // إعادة ضبط نموذج القرار عند تبديل الاستثناء المفتوح
  useEffect(() => {
    setDecision('retry_delivery');
    setReason('');
  }, [selectedId]);

  const resolveMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { decision: string; reason: string } }) =>
      api.post(`admin/exceptions/${id}/resolve`, body),
    onSuccess: () => {
      setBanner(null);
      closeDrawer();
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (e) => setBanner(arError(e)),
  });

  const reasonValid = reason.trim().length >= 2;

  return (
    <div>
      <PageHeader
        title="طابور الاستثناءات"
        description="بلاغات السائقين والمتاجر التي تحتاج قراراً إدارياً موثقاً"
      />

      {banner && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {banner}
        </div>
      )}

      <div className="mb-4">
        <Tabs tabs={STATUS_TABS} active={status} onChange={(key: string) => setStatus(key)} />
      </div>

      {exceptionsQuery.isError ? (
        <ErrorState
          message="تعذر تحميل الاستثناءات"
          onRetry={() => void exceptionsQuery.refetch()}
        />
      ) : (
        <DataTable<ExceptionRow>
          loading={exceptionsQuery.isPending}
          empty={status === 'OPEN' ? 'لا توجد استثناءات مفتوحة — ممتاز' : 'لا توجد استثناءات محلولة'}
          rows={exceptionsQuery.data?.items ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.replace(`${pathname}?id=${row.id}`, { scroll: false })}
          columns={[
            {
              key: 'order',
              header: 'الطلب',
              render: (row) => <span className="font-mono">{row.orderCode ?? '—'}</span>,
            },
            {
              key: 'type',
              header: 'النوع',
              render: (row) => <Badge tone="amber">{TYPE_AR[row.type] ?? row.type}</Badge>,
            },
            { key: 'vendor', header: 'المتجر', render: (row) => row.vendorStoreNameAr ?? '—' },
            { key: 'reporter', header: 'المبلّغ', render: (row) => row.reporterName ?? '—' },
            {
              key: 'note',
              header: 'الملاحظة',
              render: (row) => (
                <span className="block max-w-64 truncate text-gray-600">{row.note ?? '—'}</span>
              ),
            },
            {
              key: 'age',
              header: 'العمر',
              render: (row) => (
                <span className={status === 'OPEN' ? 'font-medium text-red-600' : 'text-gray-500'}>
                  {ageText(row.createdAt)}
                </span>
              ),
            },
          ]}
        />
      )}

      <Drawer
        open={selected !== null}
        onClose={closeDrawer}
        title={selected ? `استثناء ${TYPE_AR[selected.type] ?? selected.type}` : 'الاستثناء'}
        footer={
          selected && selected.status === 'OPEN' ? (
            <Button
              variant="primary"
              loading={resolveMutation.isPending}
              disabled={!reasonValid}
              onClick={() => {
                if (!selected || !reasonValid) return;
                resolveMutation.mutate({
                  id: selected.id,
                  body: { decision, reason: reason.trim() },
                });
              }}
            >
              تنفيذ القرار
            </Button>
          ) : undefined
        }
      >
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">الطلب</span>
                <span className="font-mono">{selected.orderCode ?? '—'}</span>
              </div>
              {selected.orderStatus && (
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">حالة الطلب</span>
                  <StatusBadge status={selected.orderStatus} />
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-gray-500">المتجر</span>
                <span>{selected.vendorStoreNameAr ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">المبلّغ</span>
                <span>{selected.reporterName ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-500">وقت البلاغ</span>
                <span>
                  {formatDate(selected.createdAt)} — {formatTime(selected.createdAt)}
                </span>
              </div>
              {selected.note && (
                <div className="rounded-lg bg-gray-50 p-3">
                  <span className="text-gray-500">ملاحظة المبلّغ:</span>
                  <p className="mt-1">{selected.note}</p>
                </div>
              )}
            </div>

            {selected.status === 'OPEN' ? (
              <div className="space-y-3 border-t pt-4">
                <h3 className="font-semibold">القرار الإداري</h3>
                <Select
                  label="القرار"
                  options={DECISION_OPTIONS}
                  value={decision}
                  onChange={(v: string) => setDecision(v)}
                />
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    السبب (إلزامي)
                  </label>
                  <textarea
                    className="w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-blue-500 focus:outline-none"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="اشرح سبب القرار — يُسجل في سجل التدقيق"
                  />
                </div>
                {decision === 'cancel_order' && (
                  <p className="rounded-lg bg-red-50 p-2 text-red-700">
                    سيُلغى الطلب نهائياً بفاعل الإدارة.
                  </p>
                )}
                {decision === 'mark_delivered' && (
                  <p className="rounded-lg bg-amber-50 p-2 text-amber-700">
                    سيُعتبر الطلب مسلّماً وتُكتب قيود الدفتر المالية كاملة.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3 border-t pt-4">
                <h3 className="font-semibold">القرار المتخذ</h3>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">القرار</span>
                  <Badge tone="green">{DECISION_AR[selected.decision ?? ''] ?? '—'}</Badge>
                </div>
                {selected.decisionReason && (
                  <div className="rounded-lg bg-gray-50 p-3">
                    <span className="text-gray-500">السبب:</span>
                    <p className="mt-1">{selected.decisionReason}</p>
                  </div>
                )}
                {selected.resolvedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">وقت الحل</span>
                    <span>
                      {formatDate(selected.resolvedAt)} — {formatTime(selected.resolvedAt)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

export default function ExceptionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ExceptionsInner />
    </Suspense>
  );
}
