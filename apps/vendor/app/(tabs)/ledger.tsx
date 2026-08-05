import React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  MoneyText,
  Screen,
} from '@superapp/ui';
import { formatDate, t } from '@superapp/i18n';
import { SettlementStatus, type SettlementView } from '@superapp/shared';
import { api } from '../../src/lib/api';
import type { VendorLedgerResponse } from '../../src/lib/types';

type SettlementLabelKey =
  | 'settlement_status_UNSETTLED'
  | 'settlement_status_AWAITING_CONFIRMATION'
  | 'settlement_status_SETTLED'
  | 'settlement_status_DISPUTED';

function settlementLabelKey(status: string): SettlementLabelKey {
  switch (status) {
    case SettlementStatus.AWAITING_CONFIRMATION:
      return 'settlement_status_AWAITING_CONFIRMATION';
    case SettlementStatus.SETTLED:
      return 'settlement_status_SETTLED';
    case SettlementStatus.DISPUTED:
      return 'settlement_status_DISPUTED';
    default:
      return 'settlement_status_UNSETTLED';
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** M-06 سجل المبيعات: ملخص اليوم + السجل اليومي + المستحقات والتسويات */
export default function LedgerScreen() {
  const router = useRouter();

  const query = useQuery({
    queryKey: ['vendor-ledger'],
    queryFn: () => api.get<VendorLedgerResponse>('vendor/ledger'),
    refetchInterval: 30_000,
  });

  if (query.isPending) {
    return (
      <Screen>
        <View className="px-4 pt-4">
          <AppText variant="title">{t('vendor', 'sales')}</AppText>
        </View>
        <LoadingState />
      </Screen>
    );
  }

  if (query.isError) {
    return (
      <Screen>
        <View className="px-4 pt-4">
          <AppText variant="title">{t('vendor', 'sales')}</AppText>
        </View>
        <ErrorState onRetry={() => void query.refetch()} />
      </Screen>
    );
  }

  const days = query.data.days ?? [];
  const outstanding = query.data.outstanding ?? [];
  const settlements = query.data.settlements ?? [];
  const today = days.find((d) => d.date.slice(0, 10) === todayKey());
  const awaiting = settlements.filter((s) => s.status === SettlementStatus.AWAITING_CONFIRMATION);
  const others = settlements.filter((s) => s.status !== SettlementStatus.AWAITING_CONFIRMATION);
  const isEmpty = days.length === 0 && outstanding.length === 0 && settlements.length === 0;

  return (
    <Screen>
      <View className="px-4 pt-4 pb-2">
        <AppText variant="title">{t('vendor', 'sales')}</AppText>
      </View>
      {isEmpty ? (
        <EmptyState title={t('vendor', 'ledgerEmpty')} body={t('vendor', 'ledgerEmptyBody')} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16 }}
          refreshControl={
            <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />
          }
        >
          {/* ملخص اليوم */}
          <View className="gap-2">
            <AppText variant="heading">{t('vendor', 'todaySummary')}</AppText>
            <View className="flex-row gap-3">
              <Card className="flex-1 items-center gap-1 py-5">
                <AppText variant="title">{today?.deliveredCount ?? 0}</AppText>
                <AppText variant="caption">{t('vendor', 'deliveredCountLabel')}</AppText>
              </Card>
              <Card className="flex-1 items-center gap-1 py-5">
                <MoneyText amountIqd={today?.grossSalesIqd ?? 0} className="text-brand-700" />
                <AppText variant="caption">{t('vendor', 'grossSalesLabel')}</AppText>
              </Card>
            </View>
          </View>

          {/* تسويات بانتظار التأكيد — الأهم أولاً */}
          {awaiting.length > 0 ? (
            <View className="gap-2">
              <AppText variant="heading">{t('vendor', 'settlementsTitle')}</AppText>
              {awaiting.map((s: SettlementView) => (
                <Card key={s.id} className="gap-3">
                  <View className="flex-row items-center justify-between">
                    <AppText variant="body">
                      {t('vendor', 'driverLabel')}: {s.driverName}
                    </AppText>
                    <MoneyText amountIqd={s.amountIqd} />
                  </View>
                  <AppText variant="caption" className="text-status-pending">
                    {t('vendor', settlementLabelKey(s.status))} — {t('vendor', 'ordersCount', { count: s.orderIds.length })}
                  </AppText>
                  <Button
                    title={t('vendor', 'confirmSettlement')}
                    onPress={() =>
                      router.push({ pathname: '/settlement-confirm', params: { id: s.id } })
                    }
                  />
                </Card>
              ))}
            </View>
          ) : null}

          {/* المستحق بعهدة السائقين */}
          <View className="gap-2">
            <AppText variant="heading">{t('vendor', 'outstandingTitle')}</AppText>
            {outstanding.length === 0 ? (
              <Card>
                <AppText variant="caption">{t('vendor', 'outstandingEmpty')}</AppText>
              </Card>
            ) : (
              <>
                <AppText variant="caption">{t('vendor', 'outstandingHint')}</AppText>
                {outstanding.map((row) => (
                  <Card key={row.driverId} className="flex-row items-center justify-between">
                    <View className="gap-1">
                      <AppText variant="body">
                        {row.driverName ?? t('vendor', 'driverLabel')}
                      </AppText>
                      {row.orderIds ? (
                        <AppText variant="caption">
                          {t('vendor', 'ordersCount', { count: row.orderIds.length })}
                        </AppText>
                      ) : null}
                    </View>
                    <MoneyText amountIqd={row.amountIqd} />
                  </Card>
                ))}
              </>
            )}
          </View>

          {/* السجل اليومي */}
          {days.length > 0 ? (
            <View className="gap-2">
              <AppText variant="heading">{t('vendor', 'dailyLog')}</AppText>
              {days.map((d) => (
                <Card key={d.date} className="gap-2">
                  <View className="flex-row items-center justify-between">
                    <AppText variant="body">{formatDate(d.date)}</AppText>
                    <MoneyText amountIqd={d.grossSalesIqd} />
                  </View>
                  <View className="flex-row gap-4">
                    <AppText variant="caption">
                      {t('vendor', 'deliveredCountLabel')}: {d.deliveredCount}
                    </AppText>
                    <AppText variant="caption">
                      {t('vendor', 'cancelledCountLabel')}: {d.cancelledCount}
                    </AppText>
                  </View>
                </Card>
              ))}
            </View>
          ) : null}

          {/* تسويات سابقة */}
          {others.length > 0 ? (
            <View className="gap-2 pb-8">
              <AppText variant="heading">{t('vendor', 'settlementsTitle')}</AppText>
              {others.map((s) => (
                <Card key={s.id} className="flex-row items-center justify-between">
                  <View className="gap-1">
                    <AppText variant="body">{s.driverName}</AppText>
                    <AppText variant="caption">{t('vendor', settlementLabelKey(s.status))}</AppText>
                  </View>
                  <MoneyText amountIqd={s.amountIqd} />
                </Card>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}
