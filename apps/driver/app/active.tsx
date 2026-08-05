import { formatIQD, formatTime, t } from '@superapp/i18n';
import { MapView } from '@superapp/map';
import { ScanKind } from '@superapp/shared';
import type { OrderStatus } from '@superapp/shared';
import {
  AppText,
  Button,
  Card,
  ErrorState,
  Input,
  LoadingState,
  MoneyText,
  PinInput,
  Screen,
  StatusBadge,
  cn,
} from '@superapp/ui';
import { ScanPinButton } from '@superapp/ui/scan';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, View } from 'react-native';
import { client } from '../src/lib/api';
import { errorCode, errorExpectedIqd } from '../src/lib/errors';
import { EXCEPTION_OPTIONS, type DriverExceptionType } from '../src/lib/labels';
import { openExternalMaps, openPhone } from '../src/lib/maps';
import { batchKeys, useActiveBatch } from '../src/lib/queries';
import type { BatchSummary, DriverBatchStop, DriverBatchView } from '../src/types';

function computeSummary(batch: DriverBatchView): BatchSummary {
  const delivered = batch.stops.filter((s) => s.deliveredAt);
  return {
    deliveredCount: delivered.length,
    failedCount: batch.stops.length - delivered.length,
    cashCollectedIqd: delivered.reduce((sum, s) => sum + s.totalIqd, 0),
    feesEarnedIqd: batch.totalFeeIqd,
  };
}

/** اهتزاز أفقي بسيط عند إدخال PIN خاطئ */
function useShake() {
  const translateX = useRef(new Animated.Value(0)).current;
  const shake = useCallback(() => {
    Animated.sequence(
      [10, -10, 8, -8, 4, 0].map((toValue) =>
        Animated.timing(translateX, { toValue, duration: 50, useNativeDriver: true }),
      ),
    ).start();
  }, [translateX]);
  return { translateX, shake };
}

// ─────────────────────────── D-04 الاستلام من المخبز ───────────────────────────

function PickupPhase({
  batch,
  onBatchUpdate,
}: {
  batch: DriverBatchView;
  onBatchUpdate: (b: DriverBatchView) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pinKey, setPinKey] = useState(0);
  const { translateX, shake } = useShake();

  const confirmMutation = useMutation({
    mutationFn: (pin: string) =>
      client.post<DriverBatchView>(`driver/batches/${batch.id}/confirm-pickup`, { pin }),
    onSuccess: (updated) => onBatchUpdate(updated),
    onError: (e) => {
      if (errorCode(e) === 'WRONG_PIN') {
        setError(t('driver', 'wrongPin'));
        shake();
      } else {
        setError(t('common', 'error'));
      }
      setPinKey((k) => k + 1);
    },
  });

  return (
    <Screen scroll padded>
      <AppText variant="title" className="mt-2">
        {t('driver', 'pickupFrom')} {batch.vendorNameAr}
      </AppText>

      <View className="mt-4 overflow-hidden rounded-card">
        <MapView
          center={{ lat: batch.vendorLat, lng: batch.vendorLng }}
          zoom={15}
          markers={[{ id: 'vendor', lat: batch.vendorLat, lng: batch.vendorLng, kind: 'pickup' }]}
          style={{ height: 180 }}
        />
      </View>

      <Card className="mt-4">
        <AppText variant="caption" className="text-neutral-500">
          {t('driver', 'vendorAddressLabel')}
        </AppText>
        <AppText variant="body" className="mt-1">
          {batch.vendorAddressText || '—'}
        </AppText>
        <View className="mt-3">
          <Button
            title={t('driver', 'goToVendor')}
            variant="secondary"
            onPress={() => openExternalMaps(batch.vendorLat, batch.vendorLng, batch.vendorNameAr)}
          />
        </View>
      </Card>

      <Card className="mt-3">
        <AppText variant="heading" className="mb-2">
          {t('driver', 'batchOrders')}
        </AppText>
        {batch.stops.map((stop) => (
          <View
            key={stop.orderId}
            className="flex-row items-center justify-between border-b border-neutral-100 py-2"
          >
            <AppText variant="body">{stop.orderCode}</AppText>
            <MoneyText amountIqd={stop.totalIqd} />
          </View>
        ))}
        <View className="mt-2 flex-row items-center justify-between">
          <AppText variant="body">{t('driver', 'cashAmount')}</AppText>
          <MoneyText amountIqd={batch.totalCashIqd} className="text-brand-700" />
        </View>
      </Card>

      <Animated.View style={{ transform: [{ translateX }] }}>
        <View className="mt-6 items-center">
          <AppText variant="heading" className="mb-3">
            {t('driver', 'enterPickupPin')}
          </AppText>
          <ScanPinButton
            kind={ScanKind.PICKUP}
            expectedId={batch.id}
            onScanned={(pin) => confirmMutation.mutate(pin)}
            className="mb-4"
          />
          <PinInput key={pinKey} length={4} onFilled={(pin) => confirmMutation.mutate(pin)} />
          {confirmMutation.isPending ? <LoadingState /> : null}
          {error ? (
            <AppText variant="caption" className="mt-3 text-status-cancelled">
              {error}
            </AppText>
          ) : null}
        </View>
      </Animated.View>
    </Screen>
  );
}

// ─────────────────────── D-06 لوحات التسليم والاستثناء ───────────────────────

function DeliverySheet({
  stop,
  onClose,
  onBatchUpdate,
}: {
  stop: DriverBatchStop;
  onClose: () => void;
  onBatchUpdate: (b: DriverBatchView) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pinKey, setPinKey] = useState(0);
  const { translateX, shake } = useShake();

  const deliverMutation = useMutation({
    mutationFn: (pin: string) =>
      client.post<DriverBatchView>(`driver/orders/${stop.orderId}/deliver`, {
        pin,
        cashCollectedIqd: stop.totalIqd,
      }),
    onSuccess: (updated) => {
      onClose();
      onBatchUpdate(updated);
    },
    onError: (e) => {
      const code = errorCode(e);
      if (code === 'WRONG_PIN') {
        setError(t('driver', 'wrongPin'));
        shake();
      } else if (code === 'CASH_MISMATCH') {
        setError(
          t('driver', 'cashMismatch', {
            expected: formatIQD(errorExpectedIqd(e) ?? stop.totalIqd),
          }),
        );
      } else {
        setError(t('common', 'error'));
      }
      setPinKey((k) => k + 1);
    },
  });

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-sheet bg-surface p-5 pb-8">
          <AppText variant="title" className="text-center">
            {t('driver', 'confirmDeliveryTitle')}
          </AppText>
          <AppText variant="caption" className="mt-1 text-center text-neutral-500">
            {t('order', 'orderCode')}: {stop.orderCode}
          </AppText>

          <View className="mt-5 items-center rounded-card bg-surface-muted p-4">
            <AppText variant="caption" className="text-neutral-500">
              {t('driver', 'collectAmount')}
            </AppText>
            <MoneyText amountIqd={stop.totalIqd} className="text-3xl text-brand-700" />
          </View>

          <Animated.View style={{ transform: [{ translateX }] }}>
            <View className="mt-5 items-center">
              <AppText variant="heading" className="mb-3">
                {t('driver', 'enterDeliveryPin')}
              </AppText>
              <ScanPinButton
                kind={ScanKind.DELIVERY}
                expectedId={stop.orderId}
                onScanned={(pin) => deliverMutation.mutate(pin)}
                className="mb-4"
              />
              <PinInput key={pinKey} length={4} onFilled={(pin) => deliverMutation.mutate(pin)} />
              {deliverMutation.isPending ? <LoadingState /> : null}
              {error ? (
                <AppText variant="caption" className="mt-3 text-status-cancelled">
                  {error}
                </AppText>
              ) : null}
            </View>
          </Animated.View>

          <View className="mt-5">
            <Button title={t('common', 'cancel')} variant="ghost" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ExceptionSheet({
  stop,
  onClose,
  onReported,
}: {
  stop: DriverBatchStop;
  onClose: () => void;
  onReported: (orderId: string, batch: DriverBatchView) => void;
}) {
  const [type, setType] = useState<DriverExceptionType>('customer_unavailable');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const exceptionMutation = useMutation({
    mutationFn: () =>
      client.post<{ exceptionId: string; batch: DriverBatchView }>(
        `driver/orders/${stop.orderId}/exception`,
        { type, note: note.trim() ? note.trim() : undefined },
      ),
    onSuccess: (res) => {
      onClose();
      onReported(stop.orderId, res.batch);
    },
    onError: () => setError(t('common', 'error')),
  });

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-sheet bg-surface p-5 pb-8">
          <AppText variant="title" className="text-center">
            {t('driver', 'cannotDeliver')}
          </AppText>
          <AppText variant="caption" className="mt-1 text-center text-neutral-500">
            {t('order', 'orderCode')}: {stop.orderCode}
          </AppText>

          <View className="mt-5">
            {EXCEPTION_OPTIONS.map((option) => {
              const selected = type === option.type;
              return (
                <Pressable
                  key={option.type}
                  className={cn(
                    'mb-2 min-h-touch flex-row items-center rounded-card border px-4 py-3',
                    selected ? 'border-brand-500 bg-brand-50' : 'border-neutral-200',
                  )}
                  onPress={() => setType(option.type)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <View
                    className={cn(
                      'me-3 h-5 w-5 rounded-full border-2',
                      selected ? 'border-brand-600 bg-brand-500' : 'border-neutral-400',
                    )}
                  />
                  <AppText variant="body">{t('driver', option.labelKey)}</AppText>
                </Pressable>
              );
            })}
          </View>

          <Input
            label={t('driver', 'exceptionNote')}
            value={note}
            onChangeText={setNote}
            multiline
          />

          {error ? (
            <AppText variant="caption" className="mt-3 text-status-cancelled">
              {error}
            </AppText>
          ) : null}

          <View className="mt-5">
            <Button
              title={t('driver', 'exceptionSubmit')}
              variant="danger"
              onPress={() => exceptionMutation.mutate()}
              loading={exceptionMutation.isPending}
            />
          </View>
          <View className="mt-2">
            <Button title={t('common', 'cancel')} variant="ghost" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────── D-05 مسار متعدد التوقفات ───────────────────────────

function StopCard({
  stop,
  reported,
  onDeliver,
  onException,
}: {
  stop: DriverBatchStop;
  reported: boolean;
  onDeliver: () => void;
  onException: () => void;
}) {
  const done = Boolean(stop.deliveredAt);
  return (
    <Card className={cn('mb-3', done && 'opacity-60')}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <View className="me-3 h-8 w-8 items-center justify-center rounded-full bg-brand-500">
            <AppText variant="body" className="text-white">
              {stop.sequence}
            </AppText>
          </View>
          <AppText variant="heading">{stop.orderCode}</AppText>
        </View>
        <StatusBadge status={stop.status as OrderStatus} />
      </View>

      <AppText variant="body" className="mt-2">
        {stop.addressText}
      </AppText>
      {stop.landmark ? (
        <AppText variant="caption" className="mt-1 text-neutral-500">
          {stop.landmark}
        </AppText>
      ) : null}

      <View className="mt-3 flex-row items-center justify-between rounded-card bg-surface-muted p-3">
        <AppText variant="body">{t('driver', 'collectAmount')}</AppText>
        <MoneyText amountIqd={stop.totalIqd} className="text-2xl text-brand-700" />
      </View>

      {done ? (
        <AppText variant="body" className="mt-3 text-status-delivered">
          {t('driver', 'delivered')}
          {stop.deliveredAt ? ` — ${formatTime(stop.deliveredAt)}` : ''}
        </AppText>
      ) : reported ? (
        <AppText variant="body" className="mt-3 text-status-pending">
          {t('driver', 'exceptionReported')}
        </AppText>
      ) : (
        <View className="mt-3">
          <View className="mb-2 flex-row gap-2">
            <View className="flex-1">
              <Button
                title={t('driver', 'callCustomer')}
                variant="secondary"
                onPress={() => openPhone(stop.contactPhoneMasked)}
              />
            </View>
            <View className="flex-1">
              <Button
                title={t('driver', 'openMaps')}
                variant="secondary"
                onPress={() => openExternalMaps(stop.lat, stop.lng)}
              />
            </View>
          </View>
          <Button title={t('driver', 'deliverAction')} onPress={onDeliver} />
          <View className="mt-2">
            <Button title={t('driver', 'cannotDeliver')} variant="ghost" onPress={onException} />
          </View>
        </View>
      )}
    </Card>
  );
}

function DeliveryPhase({
  batch,
  onBatchUpdate,
  onExceptionReported,
  reported,
}: {
  batch: DriverBatchView;
  onBatchUpdate: (b: DriverBatchView) => void;
  onExceptionReported: (orderId: string, b: DriverBatchView) => void;
  reported: Record<string, boolean>;
}) {
  const [deliverStop, setDeliverStop] = useState<DriverBatchStop | null>(null);
  const [exceptionStop, setExceptionStop] = useState<DriverBatchStop | null>(null);

  const stops = [...batch.stops].sort((a, b) => a.sequence - b.sequence);
  const deliveredCount = stops.filter((s) => s.deliveredAt).length;

  return (
    <Screen scroll padded>
      <AppText variant="title" className="mt-2">
        {t('driver', 'activeBatch')}
      </AppText>
      <AppText variant="body" className="mt-1 text-neutral-600">
        {batch.vendorNameAr} — {t('driver', 'progress', { done: deliveredCount, total: stops.length })}
      </AppText>

      <View className="mt-4">
        {stops.map((stop) => (
          <StopCard
            key={stop.orderId}
            stop={stop}
            reported={Boolean(reported[stop.orderId])}
            onDeliver={() => setDeliverStop(stop)}
            onException={() => setExceptionStop(stop)}
          />
        ))}
      </View>

      {deliverStop ? (
        <DeliverySheet
          stop={deliverStop}
          onClose={() => setDeliverStop(null)}
          onBatchUpdate={onBatchUpdate}
        />
      ) : null}
      {exceptionStop ? (
        <ExceptionSheet
          stop={exceptionStop}
          onClose={() => setExceptionStop(null)}
          onReported={onExceptionReported}
        />
      ) : null}
    </Screen>
  );
}

// ─────────────────────────────── D-07 ملخص الدفعة ───────────────────────────────

function SummaryView({ summary, onDone }: { summary: BatchSummary; onDone: () => void }) {
  return (
    <Screen padded>
      <View className="flex-1 justify-center">
        <AppText variant="title" className="text-center">
          {t('driver', 'batchSummaryTitle')}
        </AppText>

        <Card className="mt-6">
          <View className="flex-row items-center justify-between py-2">
            <AppText variant="body">{t('driver', 'deliveredCount')}</AppText>
            <AppText variant="heading" className="text-status-delivered">
              {summary.deliveredCount}
            </AppText>
          </View>
          <View className="flex-row items-center justify-between py-2">
            <AppText variant="body">{t('driver', 'failedCount')}</AppText>
            <AppText
              variant="heading"
              className={summary.failedCount > 0 ? 'text-status-cancelled' : undefined}
            >
              {summary.failedCount}
            </AppText>
          </View>
          <View className="flex-row items-center justify-between py-2">
            <AppText variant="body">{t('driver', 'cashCollected')}</AppText>
            <MoneyText amountIqd={summary.cashCollectedIqd} />
          </View>
          <View className="flex-row items-center justify-between py-2">
            <AppText variant="body">{t('driver', 'feesEarned')}</AppText>
            <MoneyText amountIqd={summary.feesEarnedIqd} className="text-brand-700" />
          </View>
        </Card>

        <View className="mt-6">
          <Button title={t('driver', 'backToWork')} onPress={onDone} />
        </View>
      </View>
    </Screen>
  );
}

// ────────────────────────────────── الشاشة الأم ──────────────────────────────────

/** D-04 + D-05: الدفعة النشطة شاشة كاملة — استلام ثم توقفات ثم ملخص (D-07) */
export default function ActiveBatchScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeQuery = useActiveBatch(10_000);

  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [reported, setReported] = useState<Record<string, boolean>>({});
  const lastBatchRef = useRef<DriverBatchView | null>(null);

  const batch = activeQuery.data ?? null;

  useEffect(() => {
    if (batch) lastBatchRef.current = batch;
  }, [batch]);

  // اكتمال مكتشف عبر إعادة الجلب (socket تلميح): الدفعة النشطة اختفت
  useEffect(() => {
    if (activeQuery.isSuccess && !activeQuery.data && !summary && lastBatchRef.current) {
      setSummary(computeSummary(lastBatchRef.current));
    }
  }, [activeQuery.isSuccess, activeQuery.data, summary]);

  const handleBatchUpdate = (updated: DriverBatchView) => {
    lastBatchRef.current = updated;
    if (updated.status === 'COMPLETED') {
      queryClient.setQueryData(batchKeys.active, null);
      setSummary(computeSummary(updated));
    } else {
      queryClient.setQueryData(batchKeys.active, updated);
    }
  };

  const handleExceptionReported = (orderId: string, updated: DriverBatchView) => {
    setReported((r) => ({ ...r, [orderId]: true }));
    handleBatchUpdate(updated);
  };

  if (summary) {
    return (
      <SummaryView
        summary={summary}
        onDone={() => {
          void queryClient.invalidateQueries();
          router.replace('/(tabs)');
        }}
      />
    );
  }

  if (activeQuery.isPending) return <LoadingState />;
  if (activeQuery.isError) {
    return (
      <Screen padded>
        <ErrorState onRetry={() => void activeQuery.refetch()} />
      </Screen>
    );
  }
  if (!batch) return <Redirect href="/(tabs)" />;

  if (batch.status === 'CLAIMED') {
    return <PickupPhase batch={batch} onBatchUpdate={handleBatchUpdate} />;
  }

  return (
    <DeliveryPhase
      batch={batch}
      onBatchUpdate={handleBatchUpdate}
      onExceptionReported={handleExceptionReported}
      reported={reported}
    />
  );
}
