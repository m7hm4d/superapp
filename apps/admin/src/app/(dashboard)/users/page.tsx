'use client';

import { useState } from 'react';
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
  ErrorState,
  PageHeader,
  Select,
  Tabs,
} from '@/components/ui';

interface AdminUserRow {
  id: string;
  phone: string;
  fullName: string;
  role: string;
  status: string;
  locale: string;
  createdAt: string;
}

interface UsersResponse {
  items: AdminUserRow[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 50;

const ROLE_TABS = [
  { key: '', label: 'الكل' },
  { key: 'customer', label: 'الزبائن' },
  { key: 'vendor', label: 'البائعون' },
  { key: 'driver', label: 'السائقون' },
  { key: 'admin', label: 'المشرفون' },
];

const ROLE_AR: Record<string, { label: string; tone: 'gray' | 'blue' | 'purple' | 'amber' }> = {
  customer: { label: 'زبون', tone: 'gray' },
  vendor: { label: 'بائع', tone: 'blue' },
  driver: { label: 'سائق', tone: 'purple' },
  admin: { label: 'مشرف', tone: 'amber' },
};

const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'active', label: 'نشط' },
  { value: 'blocked', label: 'محظور' },
];

const ERROR_AR: Record<string, string> = {
  USER_NOT_FOUND: 'المستخدم غير موجود',
  VALIDATION_ERROR: 'بيانات غير صالحة',
};

function arError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر تنفيذ العملية (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

export default function UsersPage() {
  const queryClient = useQueryClient();

  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const [target, setTarget] = useState<AdminUserRow | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const filters = {
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    limit: PAGE_SIZE,
    offset,
  };

  const usersQuery = useQuery({
    queryKey: ['users', filters],
    queryFn: () => api.get<UsersResponse>('admin/users', filters),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['users'] });
  useSocketEvent('config:updated', invalidate);

  const statusMutation = useMutation({
    mutationFn: ({ user, reason }: { user: AdminUserRow; reason: string }) =>
      api.patch(
        `admin/users/${user.id}/${user.status === 'blocked' ? 'unblock' : 'block'}`,
        { reason },
      ),
    onSuccess: () => {
      setBanner(null);
      setTarget(null);
      invalidate();
    },
    onError: (e) => setBanner(arError(e)),
  });

  const total = usersQuery.data?.total ?? 0;
  const targetIsBlocked = target?.status === 'blocked';

  return (
    <div>
      <PageHeader title="المستخدمون" description="كل حسابات المنصة — الحظر وفكه بسبب موثق" />

      {banner && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {banner}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs
          tabs={ROLE_TABS}
          active={role}
          onChange={(key: string) => {
            setRole(key);
            setOffset(0);
          }}
        />
        <div className="w-44">
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={(v: string) => {
              setStatus(v);
              setOffset(0);
            }}
          />
        </div>
      </div>

      {usersQuery.isError ? (
        <ErrorState message="تعذر تحميل المستخدمين" onRetry={() => void usersQuery.refetch()} />
      ) : (
        <>
          <DataTable<AdminUserRow>
            loading={usersQuery.isPending}
            empty="لا يوجد مستخدمون مطابقون"
            rows={usersQuery.data?.items ?? []}
            rowKey={(row) => row.id}
            columns={[
              { key: 'name', header: 'الاسم', render: (row) => row.fullName },
              {
                key: 'phone',
                header: 'الهاتف',
                render: (row) => <span className="font-mono" dir="ltr">{row.phone}</span>,
              },
              {
                key: 'role',
                header: 'الدور',
                render: (row) => {
                  const r = ROLE_AR[row.role] ?? { label: row.role, tone: 'gray' as const };
                  return <Badge tone={r.tone}>{r.label}</Badge>;
                },
              },
              {
                key: 'status',
                header: 'الحالة',
                render: (row) =>
                  row.status === 'blocked' ? (
                    <Badge tone="red">محظور</Badge>
                  ) : (
                    <Badge tone="green">نشط</Badge>
                  ),
              },
              {
                key: 'created',
                header: 'أُنشئ',
                render: (row) => <span className="text-gray-500">{formatDate(row.createdAt)}</span>,
              },
              {
                key: 'actions',
                header: '',
                render: (row) =>
                  row.role === 'admin' ? null : (
                    <Button
                      variant={row.status === 'blocked' ? 'secondary' : 'danger'}
                      size="sm"
                      onClick={() => setTarget(row)}
                    >
                      {row.status === 'blocked' ? 'فك الحظر' : 'حظر'}
                    </Button>
                  ),
              },
            ]}
          />

          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>
              {total} مستخدم — يظهر {Math.min(offset + 1, total)}–
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

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={targetIsBlocked ? `فك الحظر عن ${target?.fullName ?? ''}` : `حظر ${target?.fullName ?? ''}`}
        body={
          targetIsBlocked
            ? 'سيستعيد الحساب القدرة على استخدام المنصة. اذكر السبب.'
            : 'سيُمنع الحساب من استخدام المنصة فوراً. اذكر السبب.'
        }
        requireReason
        danger={!targetIsBlocked}
        confirmLabel={targetIsBlocked ? 'فك الحظر' : 'حظر'}
        onConfirm={async (reason) => {
          if (!target || !reason) return;
          await statusMutation.mutateAsync({ user: target, reason });
        }}
      />
    </div>
  );
}
