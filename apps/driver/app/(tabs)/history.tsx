import { formatDate, t } from '@superapp/i18n';
import {
  AppText,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  MoneyText,
  Screen,
} from '@superapp/ui';
import React from 'react';
import { View } from 'react-native';
import { settlementStatusLabel } from '../../src/lib/labels';
import { useDriverLedger } from '../../src/lib/queries';

/** D-09-lite — السجل: عمل اليوم + التسويات الأخيرة (السجل الكامل P1) */
export default function HistoryScreen() {
  const ledgerQuery = useDriverLedger();

  if (ledgerQuery.isPending) {
    return (
      <Screen padded>
        <LoadingState />
      </Screen>
    );
  }
  if (ledgerQuery.isError) {
    return (
      <Screen padded>
        <ErrorState onRetry={() => void ledgerQuery.refetch()} />
      </Screen>
    );
  }

  const ledger = ledgerQuery.data;
  const hasAnything = ledger.todayDeliveredCount > 0 || ledger.settlements.length > 0;

  return (
    <Screen scroll padded>
      <AppText variant="title" className="mt-2">
        {t('driver', 'tabHistory')}
      </AppText>

      <View className="mt-4 flex-row gap-3">
        <Card className="flex-1 items-center">
          <AppText variant="caption" className="text-neutral-500">
            {t('driver', 'todayDelivered')}
          </AppText>
          <AppText variant="title" className="mt-1">
            {ledger.todayDeliveredCount}
          </AppText>
        </Card>
        <Card className="flex-1 items-center">
          <AppText variant="caption" className="text-neutral-500">
            {t('driver', 'todayEarnings')}
          </AppText>
          <MoneyText amountIqd={ledger.todayFeesIqd} className="mt-1" />
        </Card>
      </View>

      {!hasAnything ? (
        <View className="mt-6">
          <EmptyState title={t('driver', 'noHistoryTitle')} body={t('driver', 'noHistoryBody')} />
        </View>
      ) : (
        <>
          <AppText variant="heading" className="mt-6 mb-3">
            {t('driver', 'settlementsHistory')}
          </AppText>
          {ledger.settlements.length === 0 ? (
            <Card>
              <AppText variant="body" className="text-center text-neutral-500">
                {t('common', 'emptyGeneric')}
              </AppText>
            </Card>
          ) : (
            ledger.settlements.map((s) => (
              <Card key={s.id} className="mb-3">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1">
                    <AppText variant="body">{s.vendorNameAr}</AppText>
                    <AppText variant="caption" className="mt-1 text-neutral-500">
                      {formatDate(s.createdAt)} — {settlementStatusLabel(s.status)} —{' '}
                      {t('driver', 'ordersCount', { count: s.orderIds.length })}
                    </AppText>
                  </View>
                  <MoneyText amountIqd={s.amountIqd} />
                </View>
              </Card>
            ))
          )}
        </>
      )}
    </Screen>
  );
}
