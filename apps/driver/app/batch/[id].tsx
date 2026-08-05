import { t } from '@superapp/i18n';
import { MapView } from '@superapp/map';
import type { MapMarker } from '@superapp/map';
import {
  AppText,
  Button,
  Card,
  DirectionalIcon,
  EmptyState,
  LoadingState,
  MoneyText,
  Screen,
} from '@superapp/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, View } from 'react-native';
import { client } from '../../src/lib/api';
import { formatMMSS, useCountdown } from '../../src/lib/countdown';
import { errorCode } from '../../src/lib/errors';
import { batchKeys, useAvailableBatches } from '../../src/lib/queries';
import type { DriverBatchView } from '../../src/types';

/** D-03 — عرض الدفعة: خريطة، ملخص، مهلة، وقبول ذري */
export default function BatchOfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const availableQuery = useAvailableBatches(true);
  const batch = availableQuery.data?.find((b) => b.id === id);
  const seconds = useCountdown(batch?.offerExpiresAt);
  const expired = seconds <= 0;

  const claimMutation = useMutation({
    mutationFn: () => client.post<DriverBatchView>(`driver/batches/${id}/claim`),
    onSuccess: (claimed) => {
      queryClient.setQueryData(batchKeys.active, claimed);
      void queryClient.invalidateQueries({ queryKey: batchKeys.all });
      router.replace('/active');
    },
    onError: (e) => {
      const code = errorCode(e);
      if (code === 'BATCH_TAKEN') {
        Alert.alert(t('driver', 'batchTaken'));
        void queryClient.invalidateQueries({ queryKey: batchKeys.available });
        router.back();
      } else if (code === 'BATCH_LIMIT') {
        Alert.alert(t('driver', 'batchLimit'));
      } else if (code === 'NOT_AVAILABLE') {
        Alert.alert(t('driver', 'mustBeOnline'));
      } else if (code === 'PENDING_APPROVAL') {
        router.replace('/activation');
      } else {
        Alert.alert(t('common', 'error'));
      }
    },
  });

  if (availableQuery.isPending) return <LoadingState />;

  if (!batch) {
    return (
      <Screen padded>
        <EmptyState
          title={t('driver', 'batchGone')}
          actionTitle={t('common', 'back')}
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const points = [
    { lat: batch.vendorLat, lng: batch.vendorLng },
    ...batch.stops.map((s) => ({ lat: s.lat, lng: s.lng })),
  ];
  const sw = {
    lat: Math.min(...points.map((p) => p.lat)),
    lng: Math.min(...points.map((p) => p.lng)),
  };
  const ne = {
    lat: Math.max(...points.map((p) => p.lat)),
    lng: Math.max(...points.map((p) => p.lng)),
  };
  const markers: MapMarker[] = [
    { id: 'vendor', lat: batch.vendorLat, lng: batch.vendorLng, kind: 'store' },
    ...batch.stops.map(
      (s): MapMarker => ({ id: s.orderId, lat: s.lat, lng: s.lng, kind: 'dropoff' }),
    ),
  ];

  return (
    <Screen scroll padded>
      <View className="mt-2 flex-row items-center justify-between">
        <Pressable className="min-h-touch min-w-touch justify-center" onPress={() => router.back()}>
          <DirectionalIcon name="chevron-forward" size={26} />
        </Pressable>
        <AppText variant="title">{t('driver', 'batchOfferTitle')}</AppText>
        <View className="min-w-touch" />
      </View>

      <View className="mt-4 overflow-hidden rounded-card">
        <MapView
          center={{ lat: batch.vendorLat, lng: batch.vendorLng }}
          markers={markers}
          fitBounds={[sw, ne]}
          style={{ height: 240 }}
        />
      </View>

      <Card className="mt-4">
        <AppText variant="heading">{batch.vendorNameAr}</AppText>
        {batch.vendorAddressText ? (
          <AppText variant="caption" className="mt-1 text-neutral-500">
            {batch.vendorAddressText}
          </AppText>
        ) : null}
        <AppText variant="body" className="mt-2">
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

        <AppText
          variant="body"
          className={expired ? 'mt-3 text-status-cancelled' : 'mt-3 text-brand-600'}
        >
          {expired
            ? t('driver', 'offerExpired')
            : t('driver', 'offerEndsIn', { time: formatMMSS(seconds) })}
        </AppText>
      </Card>

      {batch.stops.length > 0 ? (
        <Card className="mt-3">
          <AppText variant="heading" className="mb-2">
            {t('driver', 'batchOrders')}
          </AppText>
          {batch.stops.map((stop) => (
            <View
              key={stop.orderId}
              className="flex-row items-center justify-between border-b border-neutral-100 py-2"
            >
              <AppText variant="body" className="flex-1">
                {stop.sequence}. {stop.addressText}
              </AppText>
              <MoneyText amountIqd={stop.totalIqd} className="ms-2" />
            </View>
          ))}
        </Card>
      ) : null}

      <View className="mt-6 mb-4">
        <Button
          title={t('driver', 'acceptBatch')}
          onPress={() => claimMutation.mutate()}
          loading={claimMutation.isPending}
          disabled={expired || claimMutation.isPending}
        />
      </View>
    </Screen>
  );
}
