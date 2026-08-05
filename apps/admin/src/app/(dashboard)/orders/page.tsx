'use client';

import { Suspense, useState, type ChangeEvent } from 'react';
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
  Input,
  Money,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
} from '@/components/ui';

interface AdminOrderRow {
  id: string;
  code: string;
  status: string;
  vendorId: string;
  vendorStoreNameAr: string;
  customerId: string;
  customerName: string;
  subtotalIqd: number;
  deliveryFeeIqd: number;
  totalIqd: number;
  cancelledBy: string | null;
  cancelledReason: string | null;
  createdAt: string;
}

interface OrdersResponse {
  items: AdminOrderRow[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'PENDING_BAKERY', label: 'بانتظار المتجر' },
  { value: 'PREPARING', label: 'قيد التحضير' },
  { value: 'READY', label: 'جاهز' },
  { value: 'IN_DELIVERY', label: 'قيد التوصيل' },
  { value: 'DELIVERED', label: 'مسلّم' },
  { value: 'CANCELLED', label: 'ملغى' },
];

const CANCELLED_BY_AR: Record<string, string> = {
  customer: 'الزبون',
  vendor: 'المتجر',
  admin: 'الإدارة',
  system: 'النظام',
};

const ERROR_AR: Record<string, string> = {
  ILLEGAL_TRANSITION: 'لا يمكن إلغاء الطلب في حالته الحالية',
  ORDER_NOT_FOUND: 'الطلب غير موجود',
  VALIDATION_ERROR: 'بيانات غير صالحة',
};

function arError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر تنفيذ العملية (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

function OrdersInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const filters = {
    ...(status ? { status } : {}),
    ...(from ? { from: `${from}T00:00:00` } : {}),
    ...(to ? { to: `${to}T23:59:59` } : {}),
    limit: PAGE_SIZE,
    offset,
  };

  const ordersQuery = useQuery({
    queryKey: ['orders', filters],
    queryFn: () => api.get<OrdersResponse>('admin/orders', filters),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['orders'] });
  useSocketEvent('order:new', invalidate);
  useSocketEvent('order:status', invalidate);

  const selectedId = searchParams.get('id');
  const selected = (ordersQuery.data?.items ?? []).find((o) => o.id === selectedId) ?? null;
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

  const total = ordersQuery.data?.total ?? 0;
  const canCancel =
    selected !== null && selected.status !== 'DELIVERED' && selected.status !== 'CANCELLED';

  return (
    <div>
      <PageHeader title="الطلبات" description="كل طلبات المنصة مع فلاتر الحالة والزمن" />

      {banner && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {banner}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Select
            label="الحالة"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(v: string) => {
              setStatus(v);
              setOffset(0);
            }}
          />
        </div>
        <div className="w-44">
          <Input
            label="من تاريخ"
            type="date"
            value={from}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setFrom(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        <div className="w-44">
          <Input
            label="إلى تاريخ"
            type="date"
            value={to}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setTo(e.target.value);
              setOffset(0);
            }}
          />
        </div>
      </div>

      {ordersQuery.isError ? (
        <ErrorState message="تعذر تحميل الطلبات" onRetry={() => void ordersQuery.refetch()} />
      ) : (
        <>
          <DataTable<AdminOrderRow>
            loading={ordersQuery.isPending}
            empty="لا توجد طلبات مطابقة للفلاتر"
            rows={ordersQuery.data?.items ?? []}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.replace(`${pathname}?id=${row.id}`, { scroll: false })}
            columns={[
              { key: 'code', header: 'الرمز', render: (row) => <span className="font-mono">{row.code}</span> },
              { key: 'vendor', header: 'المتجر', render: (row) => row.vendorStoreNameAr },
              { key: 'customer', header: 'الزبون', render: (row) => row.customerName },
              { key: 'status', header: 'الحالة', render: (row) => <StatusBadge status={row.status} /> },
              { key: 'total', header: 'المبلغ', render: (row) => <Money amountIqd={row.totalIqd} /> },
              {
                key: 'created',
                header: 'أُنشئ',
                render: (row) => (
                  <span className="text-gray-500">
                    {formatDate(row.createdAt)} — {formatTime(row.createdAt)}
                  </span>
                ),
              },
            ]}
          />

          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>
              {total} طلب — يظهر {Math.min(offset + 1, total)}–{Math.min(offset + PAGE_SIZE, total)}
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

      <Drawer
        open={selected !== null}
        onClose={closeDrawer}
        title={selected ? `الطلب ${selected.code}` : 'تفاصيل الطلب'}
        footer={
          canCancel ? (
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
              <span className="text-gray-500">الزبون</span>
              <span>{selected.customerName}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">قيمة السلة</span>
              <Money amountIqd={selected.subtotalIqd} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">أجرة التوصيل</span>
              <Money amountIqd={selected.deliveryFeeIqd} />
            </div>
            <div className="flex items-center justify-between border-t pt-3 font-semibold">
              <span>المجموع</span>
              <Money amountIqd={selected.totalIqd} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">أُنشئ</span>
              <span>
                {formatDate(selected.createdAt)} — {formatTime(selected.createdAt)}
              </span>
            </div>
            {selected.status === 'CANCELLED' && (
              <div className="rounded-lg bg-red-50 p-3">
                <p className="font-medium text-red-800">
                  ملغى بواسطة: {CANCELLED_BY_AR[selected.cancelledBy ?? ''] ?? '—'}
                </p>
                {selected.cancelledReason && (
                  <p className="mt-1 text-red-700">السبب: {selected.cancelledReason}</p>
                )}
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

export default function OrdersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <OrdersInner />
    </Suspense>
  );
}
