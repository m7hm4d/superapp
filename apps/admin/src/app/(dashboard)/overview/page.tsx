'use client';

import { Suspense, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import { formatDate, formatIQD, formatTime } from '@superapp/i18n';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  ErrorState,
  KpiCard,
  Money,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '@/components/ui';

interface FinanceSummary {
  gmvIqd: number;
  feesIqd: number;
  commissionIqd: number;
  deliveredCount: number;
  cancelledCount: number;
  outstandingByDriver: {
    driverId: string;
    driverName: string;
    cashOnHandIqd: number;
    oldestUnsettledAt: string | null;
  }[];
}

interface StuckOrder {
  id: string;
  code: string;
  status: string;
  vendorId: string;
  vendorStoreNameAr: string;
  customerId: string;
  totalIqd: number;
  acceptTimeoutAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  createdAt: string;
}

const ERROR_AR: Record<string, string> = {
  ILLEGAL_TRANSITION: 'انتقال حالة غير مسموح لهذا الطلب',
  ORDER_NOT_FOUND: 'الطلب غير موجود',
  VALIDATION_ERROR: 'بيانات غير صالحة',
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

function OverviewInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const todayFrom = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, []);

  const summaryQuery = useQuery({
    queryKey: ['finance', 'summary', todayFrom],
    queryFn: () => api.get<FinanceSummary>('admin/finance/summary', { from: todayFrom }),
  });

  const stuckQuery = useQuery({
    queryKey: ['stuck-orders'],
    queryFn: () => api.get<StuckOrder[]>('admin/stuck-orders'),
    refetchInterval: 60_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['finance'] });
    void queryClient.invalidateQueries({ queryKey: ['stuck-orders'] });
  };
  useSocketEvent('order:new', invalidate);
  useSocketEvent('order:status', invalidate);

  const selectedId = searchParams.get('id');
  const selected = (stuckQuery.data ?? []).find((o) => o.id === selectedId) ?? null;
  const closeDrawer = () => router.replace(pathname, { scroll: false });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`admin/orders/${id}/cancel`, { reason }),
    onSuccess: () => {
      setBanner(null);
      setCancelOpen(false);
      closeDrawer();
      invalidate();
    },
    onError: (e) => setBanner(arError(e)),
  });

  const summary = summaryQuery.data;

  return (
    <div>
      <PageHeader
        title="مركز التشغيل"
        description="نظرة حية على طلبات اليوم والحالات العالقة — يتحدث تلقائياً"
      />

      {banner && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {banner}
        </div>
      )}

      {summaryQuery.isPending ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : summaryQuery.isError ? (
        <ErrorState
          message="تعذر تحميل ملخص اليوم"
          onRetry={() => void summaryQuery.refetch()}
        />
      ) : summary ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KpiCard label="طلبات اليوم المسلّمة" value={String(summary.deliveredCount)} tone="success" />
          <KpiCard label="طلبات ملغاة اليوم" value={String(summary.cancelledCount)} tone={summary.cancelledCount > 0 ? 'danger' : 'default'} />
          <KpiCard label="مبيعات اليوم (GMV)" value={formatIQD(summary.gmvIqd)} />
          <KpiCard label="أجور التوصيل" value={formatIQD(summary.feesIqd)} />
          <KpiCard label="عمولة المنصة" value={formatIQD(summary.commissionIqd)} />
        </div>
      ) : null}

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">الطلبات العالقة</h2>
          {(stuckQuery.data?.length ?? 0) > 0 && (
            <Badge tone="red">{stuckQuery.data?.length} عالق</Badge>
          )}
        </div>

        {stuckQuery.isError ? (
          <ErrorState
            message="تعذر تحميل الطلبات العالقة"
            onRetry={() => void stuckQuery.refetch()}
          />
        ) : (
          <DataTable<StuckOrder>
            loading={stuckQuery.isPending}
            empty="لا توجد طلبات عالقة الآن — كل شيء يسير جيداً"
            rows={stuckQuery.data ?? []}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.replace(`${pathname}?id=${row.id}`, { scroll: false })}
            columns={[
              { key: 'code', header: 'الرمز', render: (row) => <span className="font-mono">{row.code}</span> },
              { key: 'vendor', header: 'المتجر', render: (row) => row.vendorStoreNameAr },
              { key: 'status', header: 'الحالة', render: (row) => <StatusBadge status={row.status} /> },
              { key: 'total', header: 'المبلغ', render: (row) => <Money amountIqd={row.totalIqd} /> },
              {
                key: 'age',
                header: 'العمر',
                render: (row) => <span className="font-medium text-red-600">{ageText(row.createdAt)}</span>,
              },
            ]}
          />
        )}
      </div>

      <Drawer
        open={selected !== null}
        onClose={closeDrawer}
        title={selected ? `طلب عالق ${selected.code}` : 'طلب عالق'}
        footer={
          selected ? (
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              إلغاء الطلب إدارياً
            </Button>
          ) : undefined
        }
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">الحالة</span>
              <StatusBadge status={selected.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">المتجر</span>
              <span>{selected.vendorStoreNameAr}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">المبلغ الكلي</span>
              <Money amountIqd={selected.totalIqd} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">أُنشئ</span>
              <span>
                {formatDate(selected.createdAt)} — {formatTime(selected.createdAt)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">عالق منذ</span>
              <span className="font-medium text-red-600">{ageText(selected.createdAt)}</span>
            </div>
            {selected.acceptedAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">قُبل</span>
                <span>{formatTime(selected.acceptedAt)}</span>
              </div>
            )}
            {selected.readyAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">جاهز</span>
                <span>{formatTime(selected.readyAt)}</span>
              </div>
            )}
            {selected.pickedUpAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">استُلم للتوصيل</span>
                <span>{formatTime(selected.pickedUpAt)}</span>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="إلغاء الطلب إدارياً"
        body="سيُلغى الطلب وتُسجل العملية في سجل التدقيق. اذكر السبب."
        requireReason
        danger
        confirmLabel="تأكيد الإلغاء"
        onConfirm={async (reason) => {
          if (!selected || !reason) return;
          await cancelMutation.mutateAsync({ id: selected.id, reason });
        }}
      />
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <OverviewInner />
    </Suspense>
  );
}
