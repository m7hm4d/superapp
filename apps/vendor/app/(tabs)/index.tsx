import React, { useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  AppText,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  MoneyText,
  Screen,
  StatusBadge,
} from '@superapp/ui';
import { t } from '@superapp/i18n';
import type { OrderStatus, OrderView } from '@superapp/shared';
import { api } from '../../src/lib/api';
import { asArray } from '../../src/lib/types';

type QueueTab = 'new' | 'preparing' | 'ready';

/** دفعة حية كما يرجعها GET vendor/batches/active */
interface VendorActiveBatch {
  id: string;
  status: string;
  pickupPin: string;
  ordersCount: number;
  orderCodes: string[];
  totalCashIqd: number;
  driverName: string;
  claimedAt: string | null;
}

const TAB_LABEL_KEY = {
  new: 'queueNew',
  preparing: 'queuePreparing',
  ready: 'queueReady',
} as const;

const EMPTY_TITLE_KEY = {
  new: 'emptyNew',
  preparing: 'emptyPreparing',
  ready: 'emptyReady',
} as const;

/** ساعة حية لعداد الزمن المنقضي على الطلبات الجديدة */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function OrderCard({ order, now, onPress }: { order: OrderView; now: number; onPress: () => void }) {
  const itemsCount = order.items.reduce((sum, it) => sum + it.quantity, 0);
  const elapsedMin = Math.max(0, Math.floor((now - new Date(order.createdAt).getTime()) / 60_000));
  const isNew = order.status === 'PENDING_BAKERY';

  return (
    <Card onPress={onPress} className="gap-2">
      <View className="flex-row items-center justify-between">
        <AppText variant="heading" selectable>
          {order.code}
        </AppText>
        <StatusBadge status={order.status as OrderStatus} />
      </View>
      <View className="flex-row items-center justify-between">
        <AppText variant="body">{t('vendor', 'itemsCount', { count: itemsCount })}</AppText>
        <MoneyText amountIqd={order.totalIqd} />
      </View>
      {isNew ? (
        <AppText variant="caption" className="text-status-pending">
          {t('vendor', 'elapsedMin', { min: elapsedMin })}
        </AppText>
      ) : null}
    </Card>
  );
}

/** بطاقة دفعة حية: السائق القادم + رمز تسليم الدفعة كبيراً + أكواد الطلبات */
function ActiveBatchCard({ batch }: { batch: VendorActiveBatch }) {
  return (
    <Card className="gap-2">
      <AppText variant="heading">
        {t('vendor', 'driverOnTheWay', { name: batch.driverName })}
      </AppText>
      <View className="flex-row items-center justify-between">
        <AppText variant="caption">{t('vendor', 'pickupPin')}</AppText>
        <AppText variant="money" className="text-3xl" selectable>
          {batch.pickupPin}
        </AppText>
      </View>
      <AppText variant="caption" selectable>
        {batch.orderCodes.join('  ·  ')}
      </AppText>
    </Card>
  );
}

/** M-02 طابور الطلبات: تبويبات جديد/تحضير/جاهز مع polling احتياطي كل 10 ثوانٍ */
export default function OrdersQueueScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<QueueTab>('new');
  const now = useNow(30_000);

  const query = useQuery({
    queryKey: ['vendor-orders', tab],
    queryFn: async () => {
      const data = await api.get<unknown>('vendor/orders', { status: tab });
      return asArray<OrderView>(data, 'orders');
    },
    refetchInterval: 10_000,
  });

  // الدفعات الحية (رمز التسليم للسائق) — تُعرض فوق قائمة «جاهز» فقط
  const batchesQuery = useQuery({
    queryKey: ['vendor-batches'],
    queryFn: async () => {
      const data = await api.get<unknown>('vendor/batches/active');
      return asArray<VendorActiveBatch>(data, 'batches');
    },
    refetchInterval: 15_000,
  });
  const activeBatches = tab === 'ready' ? (batchesQuery.data ?? []) : [];

  return (
    <Screen>
      <View className="px-4 pt-4 pb-2 gap-3">
        <AppText variant="title">{t('vendor', 'tabOrders')}</AppText>
        <View className="flex-row gap-2">
          {(Object.keys(TAB_LABEL_KEY) as QueueTab[]).map((k) => (
            <Chip
              key={k}
              label={t('vendor', TAB_LABEL_KEY[k])}
              selected={tab === k}
              onPress={() => setTab(k)}
            />
          ))}
        </View>
      </View>

      {activeBatches.length > 0 ? (
        <View className="px-4 pb-2 gap-3">
          {activeBatches.map((b) => (
            <ActiveBatchCard key={b.id} batch={b} />
          ))}
        </View>
      ) : null}

      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <EmptyState
          title={t('vendor', EMPTY_TITLE_KEY[tab])}
          body={tab === 'new' ? t('vendor', 'emptyNewBody') : undefined}
        />
      ) : (
        <FlatList
          data={query.data}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              now={now}
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })}
            />
          )}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
        />
      )}
    </Screen>
  );
}
