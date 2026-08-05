import { t } from '@superapp/i18n';
import { AppText, Card, MoneyText } from '@superapp/ui';
import React from 'react';
import { View } from 'react-native';
import { formatMMSS, useCountdown } from '../lib/countdown';
import type { DriverBatchView } from '../types';

interface BatchCardProps {
  batch: DriverBatchView;
  onPress?: () => void;
}

/** بطاقة عرض دفعة في شاشة العمل (D-02) */
export function BatchCard({ batch, onPress }: BatchCardProps) {
  const seconds = useCountdown(batch.offerExpiresAt);
  const expired = seconds <= 0;

  return (
    <Card onPress={expired ? undefined : onPress} className="mb-3">
      <View className="flex-row items-center justify-between">
        <AppText variant="heading">{batch.vendorNameAr}</AppText>
        <AppText variant="caption" className={expired ? 'text-status-cancelled' : 'text-brand-600'}>
          {expired
            ? t('driver', 'offerExpired')
            : t('driver', 'offerEndsIn', { time: formatMMSS(seconds) })}
        </AppText>
      </View>

      <AppText variant="body" className="mt-1 text-neutral-600">
        {t('driver', 'batchOf', { count: batch.ordersCount })}
      </AppText>

      <View className="mt-3 flex-row items-center justify-between">
        <View>
          <AppText variant="caption" className="text-neutral-500">
            {t('driver', 'yourFee')}
          </AppText>
          <MoneyText amountIqd={batch.totalFeeIqd} className="text-brand-700" />
        </View>
        <View>
          <AppText variant="caption" className="text-neutral-500">
            {t('driver', 'cashAmount')}
          </AppText>
          <MoneyText amountIqd={batch.totalCashIqd} />
        </View>
      </View>
    </Card>
  );
}
