'use client';

import { useMemo, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@superapp/api-client';
import { formatDate, formatIQD, formatTime } from '@superapp/i18n';
import { api } from '@/lib/api';
import { useSocketEvent } from '@/lib/socket';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Input,
  KpiCard,
  Money,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
} from '@/components/ui';

interface FinanceSummary {
  gmvIqd: number;
  feesIqd: number;
  commissionIqd: number;
  deliveredCount: number;
  cancelledCount: number;
  outstandingByDriver: OutstandingDriver[];
}

interface OutstandingDriver {
  driverId: string;
  driverName: string;
  cashOnHandIqd: number;
  oldestUnsettledAt: string | null;
}

interface SettlementRow {
  id: string;
  status: string;
  vendorId: string;
  vendorStoreNameAr: string;
  driverId: string;
  driverName: string;
  amountIqd: number;
  orderIds: string[];
  disputeReason: string | null;
  createdAt: string;
  settledAt: string | null;
}

interface LedgerRow {
  id: string;
  entryType: string;
  orderId: string | null;
  vendorId: string | null;
  driverId: string | null;
  settlementId: string | null;
  amountIqd: number;
  note: string | null;
  reversalOfId: string | null;
  createdAt: string;
}

interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

const LEDGER_PAGE_SIZE = 50;

const ENTRY_TYPE_AR: Record<string, { label: string; tone: 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'purple' }> = {
  order_sale: { label: 'بيع طلب', tone: 'blue' },
  delivery_fee: { label: 'أجرة توصيل', tone: 'purple' },
  platform_commission: { label: 'عمولة المنصة', tone: 'amber' },
  cash_collected: { label: 'تحصيل نقدي', tone: 'green' },
  settlement: { label: 'تسوية', tone: 'gray' },
  reversal: { label: 'قيد عكسي', tone: 'red' },
};

const SETTLEMENT_STATUS_OPTIONS = [
  { value: '', label: 'كل التسويات' },
  { value: 'UNSETTLED', label: 'غير مسوّاة' },
  { value: 'AWAITING_CONFIRMATION', label: 'بانتظار التأكيد' },
  { value: 'SETTLED', label: 'مسوّاة' },
  { value: 'DISPUTED', label: 'متنازع عليها' },
];

const ERROR_AR: Record<string, string> = {
  ENTRY_NOT_FOUND: 'القيد غير موجود',
  ALREADY_REVERSED: 'سبق عكس هذا القيد',
  CANNOT_REVERSE_REVERSAL: 'لا يمكن عكس قيد عكسي',
  VALIDATION_ERROR: 'بيانات غير صالحة',
};

function arError(e: unknown): string {
  if (e instanceof ApiError) return ERROR_AR[e.code] ?? `تعذر تنفيذ العملية (${e.code})`;
  return 'حدث خطأ غير متوقع';
}

function ageHours(value: string | null): number {
  if (!value) return 0;
  return (Date.now() - new Date(value).getTime()) / 3_600_000;
}

function ageText(value: string | null | undefined): string {
  if (!value) return '—';
  const min = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (min < 60) return `منذ ${min} د`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `منذ ${hrs} س`;
  return `منذ ${Math.floor(hrs / 24)} يوم`;
}

function shortId(id: string | null): string {
  return id ? `${id.slice(0, 8)}…` : '—';
}

export default function FinancePage() {
  const queryClient = useQueryClient();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [settlementStatus, setSettlementStatus] = useState('');
  const [ledgerOrderId, setLedgerOrderId] = useState('');
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const [reverseTarget, setReverseTarget] = useState<LedgerRow | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const summaryFilters = {
    ...(from ? { from: `${from}T00:00:00` } : {}),
    ...(to ? { to: `${to}T23:59:59` } : {}),
  };

  const summaryQuery = useQuery({
    queryKey: ['finance', 'summary', summaryFilters],
    queryFn: () => api.get<FinanceSummary>('admin/finance/summary', summaryFilters),
  });

  const settlementsQuery = useQuery({
    queryKey: ['settlements', settlementStatus],
    queryFn: () =>
      api.get<Paginated<SettlementRow>>('admin/settlements', {
        ...(settlementStatus ? { status: settlementStatus } : {}),
        limit: 100,
        offset: 0,
      }),
  });

  const ledgerFilters = {
    ...(ledgerOrderId.trim() ? { orderId: ledgerOrderId.trim() } : {}),
    limit: LEDGER_PAGE_SIZE,
    offset: ledgerOffset,
  };

  const ledgerQuery = useQuery({
    queryKey: ['ledger', ledgerFilters],
    queryFn: () => api.get<Paginated<LedgerRow>>('admin/ledger', ledgerFilters),
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['finance'] });
    void queryClient.invalidateQueries({ queryKey: ['settlements'] });
    void queryClient.invalidateQueries({ queryKey: ['ledger'] });
  };
  useSocketEvent('order:status', invalidateAll);
  useSocketEvent('batch:status', invalidateAll);

  const reverseMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`admin/ledger/${id}/reverse`, { reason }),
    onSuccess: () => {
      setBanner(null);
      setReverseTarget(null);
      invalidateAll();
    },
    onError: (e) => setBanner(arError(e)),
  });

  const summary = summaryQuery.data;
  const ledgerItems = ledgerQuery.data?.items ?? [];
  const reversedIds = useMemo(
    () =>
      new Set(ledgerItems.map((e) => e.reversalOfId).filter((v): v is string => v !== null)),
    [ledgerItems],
  );
  const ledgerTotal = ledgerQuery.data?.total ?? 0;

  return (
    <div>
      <PageHeader
        title="المال والتسويات"
        description="ملخص مالي، نقد بذمة السائقين، التسويات، ودفتر القيود — التصحيح بقيد عكسي فقط"
      />

      {banner && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800">
          {banner}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Input
            label="من تاريخ"
            type="date"
            value={from}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Input
            label="إلى تاريخ"
            type="date"
            value={to}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTo(e.target.value)}
          />
        </div>
      </div>

      {summaryQuery.isPending ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : summaryQuery.isError ? (
        <ErrorState
          message="تعذر تحميل الملخص المالي"
          onRetry={() => void summaryQuery.refetch()}
        />
      ) : summary ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <KpiCard label="المبيعات (GMV)" value={formatIQD(summary.gmvIqd)} />
          <KpiCard label="أجور التوصيل" value={formatIQD(summary.feesIqd)} />
          <KpiCard label="عمولة المنصة" value={formatIQD(summary.commissionIqd)} tone="success" />
          <KpiCard label="طلبات مسلّمة" value={String(summary.deliveredCount)} tone="success" />
          <KpiCard
            label="طلبات ملغاة"
            value={String(summary.cancelledCount)}
            tone={summary.cancelledCount > 0 ? 'danger' : 'default'}
          />
        </div>
      ) : null}

      <div className="mt-8">
        <Card title="نقد بذمة السائقين">
          <DataTable<OutstandingDriver>
            loading={summaryQuery.isPending}
            empty="لا يوجد نقد غير مسوّى بذمة أي سائق"
            rows={summary?.outstandingByDriver ?? []}
            rowKey={(row) => row.driverId}
            columns={[
              { key: 'driver', header: 'السائق', render: (row) => row.driverName },
              {
                key: 'cash',
                header: 'النقد بالعهدة',
                render: (row) => {
                  const danger =
                    row.cashOnHandIqd > 100_000 || ageHours(row.oldestUnsettledAt) > 24;
                  return (
                    <span className={danger ? 'font-semibold text-red-600' : ''}>
                      {formatIQD(row.cashOnHandIqd)}
                    </span>
                  );
                },
              },
              {
                key: 'oldest',
                header: 'أقدم تحصيل غير مسوّى',
                render: (row) => {
                  const danger = ageHours(row.oldestUnsettledAt) > 24;
                  return (
                    <span className={danger ? 'font-medium text-red-600' : 'text-gray-500'}>
                      {ageText(row.oldestUnsettledAt)}
                    </span>
                  );
                },
              },
              {
                key: 'flag',
                header: '',
                render: (row) =>
                  row.cashOnHandIqd > 100_000 || ageHours(row.oldestUnsettledAt) > 24 ? (
                    <Badge tone="red">يتطلب متابعة</Badge>
                  ) : null,
              },
            ]}
          />
        </Card>
      </div>

      <div className="mt-8">
        <Card
          title="التسويات"
          actions={
            <div className="w-48">
              <Select
                options={SETTLEMENT_STATUS_OPTIONS}
                value={settlementStatus}
                onChange={(v: string) => setSettlementStatus(v)}
              />
            </div>
          }
        >
          {settlementsQuery.isError ? (
            <ErrorState
              message="تعذر تحميل التسويات"
              onRetry={() => void settlementsQuery.refetch()}
            />
          ) : (
            <DataTable<SettlementRow>
              loading={settlementsQuery.isPending}
              empty="لا توجد تسويات مطابقة"
              rows={settlementsQuery.data?.items ?? []}
              rowKey={(row) => row.id}
              columns={[
                { key: 'vendor', header: 'المتجر', render: (row) => row.vendorStoreNameAr },
                { key: 'driver', header: 'السائق', render: (row) => row.driverName },
                { key: 'amount', header: 'المبلغ', render: (row) => <Money amountIqd={row.amountIqd} /> },
                {
                  key: 'orders',
                  header: 'الطلبات',
                  render: (row) => String(row.orderIds.length),
                },
                { key: 'status', header: 'الحالة', render: (row) => <StatusBadge status={row.status} /> },
                {
                  key: 'created',
                  header: 'أُنشئت',
                  render: (row) => <span className="text-gray-500">{formatDate(row.createdAt)}</span>,
                },
                {
                  key: 'settled',
                  header: 'سُوّيت',
                  render: (row) =>
                    row.settledAt ? (
                      <span className="text-gray-500">
                        {formatDate(row.settledAt)} — {formatTime(row.settledAt)}
                      </span>
                    ) : (
                      '—'
                    ),
                },
              ]}
            />
          )}
        </Card>
      </div>

      <div className="mt-8">
        <Card
          title="دفتر القيود"
          actions={
            <div className="w-72">
              <Input
                placeholder="فلترة بمعرّف الطلب (UUID)"
                value={ledgerOrderId}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setLedgerOrderId(e.target.value);
                  setLedgerOffset(0);
                }}
              />
            </div>
          }
        >
          {ledgerQuery.isError ? (
            <ErrorState
              message="تعذر تحميل دفتر القيود"
              onRetry={() => void ledgerQuery.refetch()}
            />
          ) : (
            <>
              <DataTable<LedgerRow>
                loading={ledgerQuery.isPending}
                empty="لا توجد قيود مطابقة"
                rows={ledgerItems}
                rowKey={(row) => row.id}
                columns={[
                  {
                    key: 'type',
                    header: 'النوع',
                    render: (row) => {
                      const t = ENTRY_TYPE_AR[row.entryType] ?? {
                        label: row.entryType,
                        tone: 'gray' as const,
                      };
                      return <Badge tone={t.tone}>{t.label}</Badge>;
                    },
                  },
                  {
                    key: 'amount',
                    header: 'المبلغ',
                    render: (row) => (
                      <span
                        className={
                          row.amountIqd < 0
                            ? 'font-medium text-red-600'
                            : 'font-medium text-green-700'
                        }
                        dir="ltr"
                      >
                        {row.amountIqd > 0 ? '+' : ''}
                        {formatIQD(row.amountIqd)}
                      </span>
                    ),
                  },
                  {
                    key: 'order',
                    header: 'الطلب',
                    render: (row) => <span className="font-mono text-xs">{shortId(row.orderId)}</span>,
                  },
                  {
                    key: 'vendor',
                    header: 'البائع',
                    render: (row) => <span className="font-mono text-xs">{shortId(row.vendorId)}</span>,
                  },
                  {
                    key: 'driver',
                    header: 'السائق',
                    render: (row) => <span className="font-mono text-xs">{shortId(row.driverId)}</span>,
                  },
                  {
                    key: 'note',
                    header: 'ملاحظة',
                    render: (row) => (
                      <span className="block max-w-48 truncate text-gray-600">{row.note ?? '—'}</span>
                    ),
                  },
                  {
                    key: 'created',
                    header: 'التاريخ',
                    render: (row) => (
                      <span className="text-gray-500">
                        {formatDate(row.createdAt)} — {formatTime(row.createdAt)}
                      </span>
                    ),
                  },
                  {
                    key: 'actions',
                    header: '',
                    render: (row) => {
                      if (row.entryType === 'reversal') return null;
                      if (reversedIds.has(row.id)) return <Badge tone="gray">معكوس</Badge>;
                      return (
                        <Button variant="danger" size="sm" onClick={() => setReverseTarget(row)}>
                          عكس القيد
                        </Button>
                      );
                    },
                  },
                ]}
              />

              <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
                <span>
                  {ledgerTotal} قيد — يظهر {Math.min(ledgerOffset + 1, ledgerTotal)}–
                  {Math.min(ledgerOffset + LEDGER_PAGE_SIZE, ledgerTotal)}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={ledgerOffset === 0}
                    onClick={() => setLedgerOffset(Math.max(0, ledgerOffset - LEDGER_PAGE_SIZE))}
                  >
                    السابق
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={ledgerOffset + LEDGER_PAGE_SIZE >= ledgerTotal}
                    onClick={() => setLedgerOffset(ledgerOffset + LEDGER_PAGE_SIZE)}
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
        open={reverseTarget !== null}
        onClose={() => setReverseTarget(null)}
        title="عكس قيد الدفتر"
        body={
          reverseTarget
            ? `سيُنشأ قيد عكسي بمبلغ ${formatIQD(-reverseTarget.amountIqd)} مرتبط بالقيد الأصلي — لا حذف في الدفتر. اذكر السبب.`
            : undefined
        }
        requireReason
        danger
        confirmLabel="تأكيد العكس"
        onConfirm={async (reason) => {
          if (!reverseTarget || !reason) return;
          await reverseMutation.mutateAsync({ id: reverseTarget.id, reason });
        }}
      />
    </div>
  );
}
