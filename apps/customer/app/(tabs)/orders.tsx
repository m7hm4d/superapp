import { formatDate, t } from '@superapp/i18n';
import type { OrderView } from '@superapp/shared';
import { OrderStatus } from '@superapp/shared';
import {
  AppText,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  MoneyText,
  Screen,
  StatusBadge,
} from '@superapp/ui';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { SectionList, View } from 'react-native';
import { isActiveOrder, useOrdersQuery } from '../../src/lib/queries';
import { useAuthStore } from '../../src/stores/auth';

function OrderCard({ order, onPress }: { order: OrderView; onPress: () => void }) {
  return (
    <Card onPress={onPress} className="mb-3">
      <View className="flex-row items-center justify-between">
        <AppText variant="heading">{order.code}</AppText>
        <StatusBadge status={order.status as OrderStatus} />
      </View>
      <View className="mt-2 flex-row items-center justify-between">
        <AppText variant="caption">{formatDate(order.createdAt)}</AppText>
        <MoneyText amountIqd={order.totalIqd} />
      </View>
      <AppText variant="caption" className="mt-1">
        {order.vendorNameAr}
      </AppText>
    </Card>
  );
}

/** C-08 طلباتي: النشط أولاً ثم السجل؛ الضيف يُدعى لتسجيل الدخول */
export default function OrdersScreen() {
  const router = useRouter();
  const authStatus = useAuthStore((s) => s.status);
  const ordersQuery = useOrdersQuery(authStatus === 'authed');

  const sections = useMemo(() => {
    const orders = ordersQuery.data ?? [];
    const active = orders.filter(isActiveOrder);
    const history = orders.filter((o) => !isActiveOrder(o));
    const result: { title: string; data: OrderView[] }[] = [];
    if (active.length > 0) result.push({ title: t('customer', 'activeOrders'), data: active });
    if (history.length > 0) result.push({ title: t('customer', 'pastOrders'), data: history });
    return result;
  }, [ordersQuery.data]);

  return (
    <Screen scroll={false} padded={false}>
      <View className="bg-surface px-4 py-3">
        <AppText variant="title">{t('customer', 'tabOrders')}</AppText>
      </View>

      {authStatus !== 'authed' ? (
        <EmptyState
          title={t('customer', 'guestTitle')}
          body={t('customer', 'ordersLoginBody')}
          actionTitle={t('auth', 'login')}
          onAction={() => router.push('/auth/login')}
        />
      ) : ordersQuery.isLoading ? (
        <LoadingState />
      ) : ordersQuery.isError ? (
        <ErrorState onRetry={() => void ordersQuery.refetch()} />
      ) : sections.length === 0 ? (
        <EmptyState
          title={t('customer', 'noOrders')}
          body={t('customer', 'noOrdersBody')}
          actionTitle={t('customer', 'exploreBakeries')}
          onAction={() => router.push('/(tabs)')}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(order) => order.id}
          renderItem={({ item }) => (
            <OrderCard order={item} onPress={() => router.push(`/order/${item.id}`)} />
          )}
          renderSectionHeader={({ section }) => (
            <AppText variant="heading" className="mb-2 mt-3">
              {section.title}
            </AppText>
          )}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          refreshing={ordersQuery.isRefetching}
          onRefresh={() => void ordersQuery.refetch()}
        />
      )}
    </Screen>
  );
}
