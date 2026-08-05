'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import { formatDate } from '@superapp/i18n';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Drawer,
  ErrorState,
  PageHeader,
  Skeleton,
  Tabs,
} from '@/components/ui';

interface ApprovalRow {
  type: 'vendor' | 'driver';
  profileId: string;
  userId: string;
  phone: string;
  fullName: string;
  storeNameAr?: string | null;
  category?: string | null;
  addressText?: string | null;
  vehicleType?: string | null;
  cityId: string;
  approvalStatus: string;
  rejectionReason: string | null;
  createdAt: string;
}

interface ApprovalsResponse {
  items: ApprovalRow[];
  total: number;
  limit: number;
  offset: number;
}

const TYPE_TABS = [
  { key: 'vendor', label: 'البائعون' },
  { key: 'driver', label: 'السائقون' },
];

const STATUS_TABS = [
  { key: 'pending', label: 'بانتظار الموافقة' },
  { key: 'approved', label: 'معتمدون' },
  { key: 'rejected', label: 'مرفوضون' },
];

const CATEGORY_AR: Record<string, string> = {
  bakery: 'مخبز',
  vegetables: 'خضار وفواكه',
  market: 'سوق / بقالة',
  construction: 'مواد بناء',
};

const VEHICLE_AR: Record<string, string> = {
  motorcycle: 'دراجة نارية',
  car: 'سيارة',
  tuktuk: 'توك توك',
};

const STATUS_AR: Record<string, { label: string; tone: 'amber' | 'green' | 'red' | 'gray' }> = {
  pending: { label: 'قيد الانتظار', tone: 'amber' },
  approved: { label: 'معتمد', tone: 'green' },
  rejected: { label: 'مرفوض', tone: 'red' },
  suspended: { label: 'موقوف', tone: 'gray' },
};

const ERROR_AR: Record<string, string> = {
  PROFILE_NOT_FOUND: 'الملف غير موجود',
  VALIDATION_ERROR: 'بيانات غير صالحة',
};

function arError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر تنفيذ العملية (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

function ApprovalsInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [type, setType] = useState<'vendor' | 'driver'>('vendor');
  const [status, setStatus] = useState('pending');
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const approvalsQuery = useQuery({
    queryKey: ['approvals', type, status],
    queryFn: () =>
      api.get<ApprovalsResponse>('admin/approvals', { type, status, limit: 100, offset: 0 }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['approvals'] });
  useSocketEvent('config:updated', invalidate);

  const selectedId = searchParams.get('id');
  const selected =
    (approvalsQuery.data?.items ?? []).find((r) => r.profileId === selectedId) ?? null;
  const closeDrawer = () => router.replace(pathname, { scroll: false });

  const approveMutation = useMutation({
    mutationFn: (row: ApprovalRow) =>
      api.post(`admin/approvals/${row.type}/${row.profileId}/approve`, {}),
    onSuccess: () => {
      setBanner(null);
      setApproveOpen(false);
      closeDrawer();
      invalidate();
    },
    onError: (e) => setBanner(arError(e)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ row, reason }: { row: ApprovalRow; reason: string }) =>
      api.post(`admin/approvals/${row.type}/${row.profileId}/reject`, { reason }),
    onSuccess: () => {
      setBanner(null);
      setRejectOpen(false);
      closeDrawer();
      invalidate();
    },
    onError: (e) => setBanner(arError(e)),
  });

  return (
    <div>
      <PageHeader
        title="الموافقات"
        description="اعتماد أو رفض طلبات انضمام البائعين والسائقين"
      />

      {banner && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {banner}
        </div>
      )}

      <div className="mb-2">
        <Tabs tabs={TYPE_TABS} active={type} onChange={(key: string) => setType(key as 'vendor' | 'driver')} />
      </div>
      <div className="mb-4">
        <Tabs tabs={STATUS_TABS} active={status} onChange={(key: string) => setStatus(key)} />
      </div>

      {approvalsQuery.isError ? (
        <ErrorState
          message="تعذر تحميل قائمة الموافقات"
          onRetry={() => void approvalsQuery.refetch()}
        />
      ) : (
        <DataTable<ApprovalRow>
          loading={approvalsQuery.isPending}
          empty="لا توجد ملفات في هذه القائمة"
          rows={approvalsQuery.data?.items ?? []}
          rowKey={(row) => row.profileId}
          onRowClick={(row) =>
            router.replace(`${pathname}?id=${row.profileId}`, { scroll: false })
          }
          columns={[
            { key: 'name', header: 'الاسم', render: (row) => row.fullName },
            {
              key: 'phone',
              header: 'الهاتف',
              render: (row) => <span className="font-mono" dir="ltr">{row.phone}</span>,
            },
            {
              key: 'detail',
              header: type === 'vendor' ? 'المتجر' : 'المركبة',
              render: (row) =>
                type === 'vendor'
                  ? (row.storeNameAr ?? '—')
                  : (VEHICLE_AR[row.vehicleType ?? ''] ?? '—'),
            },
            {
              key: 'category',
              header: 'الفئة',
              render: (row) =>
                type === 'vendor' ? (CATEGORY_AR[row.category ?? ''] ?? '—') : '—',
            },
            {
              key: 'created',
              header: 'تاريخ الطلب',
              render: (row) => <span className="text-gray-500">{formatDate(row.createdAt)}</span>,
            },
            {
              key: 'status',
              header: 'الحالة',
              render: (row) => {
                const s = STATUS_AR[row.approvalStatus] ?? { label: row.approvalStatus, tone: 'gray' as const };
                return <Badge tone={s.tone}>{s.label}</Badge>;
              },
            },
          ]}
        />
      )}

      <Drawer
        open={selected !== null}
        onClose={closeDrawer}
        title={selected ? selected.fullName : 'الملف'}
        footer={
          selected ? (
            <div className="flex gap-2">
              {selected.approvalStatus !== 'approved' && (
                <Button variant="primary" onClick={() => setApproveOpen(true)}>
                  تفعيل
                </Button>
              )}
              {selected.approvalStatus !== 'rejected' && (
                <Button variant="danger" onClick={() => setRejectOpen(true)}>
                  رفض
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">الحالة</span>
              {(() => {
                const s = STATUS_AR[selected.approvalStatus] ?? {
                  label: selected.approvalStatus,
                  tone: 'gray' as const,
                };
                return <Badge tone={s.tone}>{s.label}</Badge>;
              })()}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">الهاتف</span>
              <span className="font-mono" dir="ltr">
                {selected.phone}
              </span>
            </div>
            {selected.type === 'vendor' ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">اسم المتجر</span>
                  <span>{selected.storeNameAr ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">الفئة</span>
                  <span>{CATEGORY_AR[selected.category ?? ''] ?? '—'}</span>
                </div>
                {selected.addressText && (
                  <div>
                    <span className="text-gray-500">العنوان</span>
                    <p className="mt-1">{selected.addressText}</p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">نوع المركبة</span>
                <span>{VEHICLE_AR[selected.vehicleType ?? ''] ?? '—'}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-gray-500">تاريخ الطلب</span>
              <span>{formatDate(selected.createdAt)}</span>
            </div>
            {selected.rejectionReason && (
              <div className="rounded-lg bg-red-50 p-3 text-red-700">
                سبب الرفض السابق: {selected.rejectionReason}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title={type === 'vendor' ? 'تفعيل البائع' : 'تفعيل السائق'}
        body="سيتمكن الحساب من العمل على المنصة فوراً بعد التفعيل."
        confirmLabel="تفعيل"
        onConfirm={async () => {
          if (!selected) return;
          await approveMutation.mutateAsync(selected);
        }}
      />

      <ConfirmDialog
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={type === 'vendor' ? 'رفض البائع' : 'رفض السائق'}
        body="اذكر سبب الرفض — سيُسجل في الملف ويظهر لصاحب الطلب."
        requireReason
        danger
        confirmLabel="رفض"
        onConfirm={async (reason) => {
          if (!selected || !reason) return;
          await rejectMutation.mutateAsync({ row: selected, reason });
        }}
      />
    </div>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <ApprovalsInner />
    </Suspense>
  );
}
