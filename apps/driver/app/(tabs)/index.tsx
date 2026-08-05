import { t } from '@superapp/i18n';
import type { BatchOfferedEvent, BatchStatusEvent } from '@superapp/shared';
import {
  AppText,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Toggle,
  cn,
} from '@superapp/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { BatchCard } from '../../src/components/BatchCard';
import { client } from '../../src/lib/api';
import { errorCode } from '../../src/lib/errors';
import { batchKeys, useActiveBatch, useAvailableBatches } from '../../src/lib/queries';
import { useSocket } from '../../src/lib/socket';
import { useAuthStore } from '../../src/stores/auth';
import type { DriverBatchView } from '../../src/types';

function IndicatorChip({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  return (
    <View
      className={cn(
        'rounded-full px-3 py-1',
        ok ? 'bg-status-delivered/10' : 'bg-status-cancelled/10',
      )}
    >
      <AppText
        variant="caption"
        className={ok ? 'text-status-delivered' : 'text-status-cancelled'}
      >
        {ok ? okLabel : badLabel}
      </AppText>
    </View>
  );
}

/** D-02 — شاشة العمل: متصل/غير متصل + الدفعات المتاحة */
export default function WorkScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { socket, connected } = useSocket();
  const profile = useAuthStore((s) => s.profile);
  const setProfile = useAuthStore((s) => s.setProfile);

  const [isOnline, setIsOnline] = useState(profile?.isAvailable ?? false);
  const [gpsOk, setGpsOk] = useState<boolean | null>(null);

  const activeQuery = useActiveBatch();
  const availableQuery = useAvailableBatches(isOnline);

  // مزامنة الحالة مع الملف عند الترطيب المتأخر
  useEffect(() => {
    if (profile) setIsOnline(profile.isAvailable);
  }, [profile]);

  const pingLocation = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setGpsOk(false);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setGpsOk(true);
      await client.patch('driver/location', {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
    } catch {
      setGpsOk(false);
    }
  }, []);

  const availabilityMutation = useMutation({
    mutationFn: (isAvailable: boolean) =>
      client.patch<{ isAvailable: boolean }>('driver/availability', { isAvailable }),
    onSuccess: (res) => {
      setIsOnline(res.isAvailable);
      if (profile) setProfile({ ...profile, isAvailable: res.isAvailable });
      if (res.isAvailable) {
        // نبضة موقع واحدة عند التحول لمتصل
        void pingLocation();
        void queryClient.invalidateQueries({ queryKey: batchKeys.available });
      }
    },
    onError: (e) => {
      if (errorCode(e) === 'PENDING_APPROVAL') router.replace('/activation');
    },
  });

  // بث حي: إدراج فوري للعروض الجديدة وإزالة المسحوبة — الحقيقة تبقى عبر REST
  useEffect(() => {
    if (!socket) return;

    const onOffered = (e: BatchOfferedEvent) => {
      queryClient.setQueryData<DriverBatchView[]>(batchKeys.available, (old) => {
        if (!old || old.some((b) => b.id === e.batchId)) return old;
        const placeholder: DriverBatchView = {
          id: e.batchId,
          status: 'OFFERED',
          vendorNameAr: e.vendorName,
          vendorLat: e.vendorLat,
          vendorLng: e.vendorLng,
          vendorAddressText: '',
          ordersCount: e.ordersCount,
          totalFeeIqd: e.totalFeeIqd,
          totalCashIqd: 0,
          offerExpiresAt: e.offerExpiresAt,
          stops: [],
        };
        return [placeholder, ...old];
      });
      void queryClient.invalidateQueries({ queryKey: batchKeys.available });
    };

    const onStatus = (e: BatchStatusEvent) => {
      if (e.status === 'CLAIMED' || e.status === 'EXPIRED' || e.status === 'CANCELLED') {
        queryClient.setQueryData<DriverBatchView[]>(batchKeys.available, (old) =>
          old?.filter((b) => b.id !== e.batchId),
        );
      }
      void queryClient.invalidateQueries({ queryKey: batchKeys.all });
    };

    socket.on('batch:offered', onOffered);
    socket.on('batch:status', onStatus);
    return () => {
      socket.off('batch:offered', onOffered);
      socket.off('batch:status', onStatus);
    };
  }, [socket, queryClient]);

  // قاعدة الدفعة النشطة الواحدة: وجودها يجعل الرحلة شاشة كاملة
  if (activeQuery.data) return <Redirect href="/active" />;

  const batches = availableQuery.data ?? [];

  return (
    <Screen scroll padded>
      <View className="mt-2 flex-row items-center justify-between">
        <AppText variant="title">{t('driver', 'tabWork')}</AppText>
        <View className="flex-row gap-2">
          <IndicatorChip
            ok={connected}
            okLabel={t('driver', 'serverConnected')}
            badLabel={t('driver', 'serverDisconnected')}
          />
          {gpsOk !== null ? (
            <IndicatorChip
              ok={gpsOk}
              okLabel={t('driver', 'gpsOn')}
              badLabel={t('driver', 'gpsOff')}
            />
          ) : null}
        </View>
      </View>

      <Card className="mt-4">
        <Toggle
          value={isOnline}
          onValueChange={(v) => {
            if (!availabilityMutation.isPending) availabilityMutation.mutate(v);
          }}
          label={t('driver', isOnline ? 'online' : 'offline')}
        />
      </Card>

      <AppText variant="heading" className="mt-6 mb-3">
        {t('driver', 'availableBatches')}
      </AppText>

      {!isOnline ? (
        <EmptyState
          title={t('driver', 'offlineTitle')}
          body={t('driver', 'goOnlineHint')}
          actionTitle={t('driver', 'online')}
          onAction={() => {
            if (!availabilityMutation.isPending) availabilityMutation.mutate(true);
          }}
        />
      ) : availableQuery.isPending ? (
        <LoadingState />
      ) : availableQuery.isError ? (
        <ErrorState onRetry={() => void availableQuery.refetch()} />
      ) : batches.length === 0 ? (
        <EmptyState title={t('driver', 'noBatchesTitle')} body={t('driver', 'noBatchesBody')} />
      ) : (
        batches.map((batch) => (
          <BatchCard key={batch.id} batch={batch} onPress={() => router.push(`/batch/${batch.id}`)} />
        ))
      )}
    </Screen>
  );
}
