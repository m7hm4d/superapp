'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import { formatDate, formatTime } from '@superapp/i18n';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  ErrorState,
  Money,
  PageHeader,
  Skeleton,
  StatusBadge,
  Tabs,
} from '@/components/ui';

interface AdminBatchRow {
  id: string;
  cityId: string;
  status: string;
  vendorId: string;
  vendorStoreNameAr: string;
  driverId: string | null;
  driverName: string | null;
  totalFeeIqd: number;
  totalCashIqd: number;
  ordersCount: number;
  deliveredCount: number;
  offerExpiresAt: string | null;
  claimedAt: string | null;
  pickupConfirmedAt: string | null;
  completedAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
}

interface BatchesResponse {
  items: AdminBatchRow[];
  total: number;
  limit: number;
  offset: number;
}

const STATUS_TABS = [
  { key: 'OFFERED', label: 'معروضة' },
  { key: 'CLAIMED', label: 'مقبولة' },
  { key: 'ACTIVE', label: 'نشطة' },
  { key: 'COMPLETED', label: 'مكتملة' },
  { key: 'EXPIRED', label: 'منتهية' },
  { key: 'CANCELLED', label: 'ملغاة' },
];

const ERROR_AR: Record<string, string> = {
  BATCH_NOT_FOUND: 'الدفعة غير موجودة',
  ILLEGAL_TRANSITION: 'لا يمكن إلغاء الدفعة في حالتها الحالية',
  VALIDATION_ERROR: 'بيانات غير صالحة',
};

function arError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر تنفيذ العملية (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

function BatchesInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('OFFERED');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const batchesQuery = useQuery({
    queryKey: ['batches', status],
    queryFn: () => api.get<BatchesResponse>('admin/batches', { status, limit: 100, offset: 0 }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['batches'] });
  useSocketEvent('batch:offered', invalidate);
  useSocketEvent('batch:status', invalidate);
  useSocketEvent('order:status', invalidate);

  const selectedId = searchParams.get('id');
  const selected = (batchesQuery.data?.items ?? []).find((b) => b.id === selectedId) ?? null;
  const closeDrawer = () => router.replace(pathname, { scroll: false });

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`admin/batches/${id}/cancel`, { reason }),
    onSuccess: () => {
      setBanner(null);
      setCancelOpen(false);
      closeDrawer();
      invalidate();
    },
    onError: (e) => setBanner(arError(e)),
  });

  const canCancel =
    selected !== null && (selected.status === 'OFFERED' || selected.status === 'CLAIMED');

  return (
    <div>
      <PageHeader
        title="الدفعات والتوزيع"
        description="دفعات التوصيل حسب الحالة — الإلغاء الإداري متاح للمعروضة والمقبولة فقط"
      />

      {banner && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {banner}
        </div>
      )}

      <div className="mb-4">
        <Tabs
          tabs={STATUS_TABS}
          active={status}
          onChange={(key: string) => setStatus(key)}
        />
      </div>

      {batchesQuery.isError ? (
        <ErrorState message="تعذر تحميل الدفعات" onRetry={() => void batchesQuery.refetch()} />
      ) : (
        <DataTable<AdminBatchRow>
          loading={batchesQuery.isPending}
          empty="لا توجد دفعات بهذه الحالة"
          rows={batchesQuery.data?.items ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.replace(`${pathname}?id=${row.id}`, { scroll: false })}
          columns={[
            { key: 'vendor', header: 'المتجر', render: (row) => row.vendorStoreNameAr },
            { key: 'driver', header: 'السائق', render: (row) => row.driverName ?? '—' },
            { key: 'orders', header: 'الطلبات', render: (row) => String(row.ordersCount) },
            {
              key: 'delivered',
              header: 'المسلّم',
              render: (row) => `${row.deliveredCount}/${row.ordersCount}`,
            },
            { key: 'fee', header: 'الأجرة', render: (row) => <Money amountIqd={row.totalFeeIqd} /> },
            { key: 'cash', header: 'النقد', render: (row) => <Money amountIqd={row.totalCashIqd} /> },
            {
              key: 'created',
              header: 'أُنشئت',
              render: (row) => (
                <span className="text-gray-500">
                  {formatDate(row.createdAt)} — {formatTime(row.createdAt)}
                </span>
              ),
            },
            { key: 'status', header: 'الحالة', render: (row) => <StatusBadge status={row.status} /> },
          ]}
        />
      )}

      <Drawer
        open={selected !== null}
        onClose={closeDrawer}
        title="تفاصيل الدفعة"
        footer={
          canCancel ? (
            <Button variant="danger" onClick={() => setCancelOpen(true)}>
              إلغاء الدفعة وتحرير الطلبات
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
              <span className="text-gray-500">السائق</span>
              <span>{selected.driverName ?? 'لم يُقبل بعد'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">عدد الطلبات</span>
              <span>
                {selected.deliveredCount}/{selected.ordersCount} مسلّم
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">إجمالي الأجرة</span>
              <Money amountIqd={selected.totalFeeIqd} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">إجمالي النقد</span>
              <Money amountIqd={selected.totalCashIqd} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">أُنشئت</span>
              <span>
                {formatDate(selected.createdAt)} — {formatTime(selected.createdAt)}
              </span>
            </div>
            {selected.offerExpiresAt && selected.status === 'OFFERED' && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">ينتهي العرض</span>
                <span>{formatTime(selected.offerExpiresAt)}</span>
              </div>
            )}
            {selected.claimedAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">قُبلت</span>
                <span>{formatTime(selected.claimedAt)}</span>
              </div>
            )}
            {selected.pickupConfirmedAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">تأكيد الاستلام</span>
                <span>{formatTime(selected.pickupConfirmedAt)}</span>
              </div>
            )}
            {selected.completedAt && (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">اكتملت</span>
                <span>{formatTime(selected.completedAt)}</span>
              </div>
            )}
            {selected.cancelledReason && (
              <div className="rounded-lg bg-red-50 p-3 text-red-700">
                سبب الإلغاء: {selected.cancelledReason}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="إلغاء الدفعة"
        body="ستُلغى الدفعة وتُحرَّر طلباتها ليعاد تجميعها تلقائياً. اذكر السبب."
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

export default function BatchesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <BatchesInner />
    </Suspense>
  );
}
