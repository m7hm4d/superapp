import { formatTime, t } from '@superapp/i18n';
import type { OrderView } from '@superapp/shared';
import { OrderStatus, ScanKind } from '@superapp/shared';
import {
  AppText,
  Button,
  Card,
  ErrorState,
  Input,
  LoadingState,
  MoneyText,
  Screen,
  StatusBadge,
  cn,
  PinOrQr,
} from '@superapp/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { api, apiErrorMessage } from '../../src/lib/api';
import { isActiveOrder, useOrderQuery } from '../../src/lib/queries';
import { useSocket } from '../../src/lib/socket';

const TIMELINE_STEPS = [
  OrderStatus.PENDING_BAKERY,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.IN_DELIVERY,
  OrderStatus.DELIVERED,
] as const;

const STEP_LABEL_KEY = {
  [OrderStatus.PENDING_BAKERY]: 'status_PENDING_BAKERY',
  [OrderStatus.PREPARING]: 'status_PREPARING',
  [OrderStatus.READY]: 'status_READY',
  [OrderStatus.IN_DELIVERY]: 'status_IN_DELIVERY',
  [OrderStatus.DELIVERED]: 'status_DELIVERED',
} as const;

function stepTimestamp(order: OrderView, step: (typeof TIMELINE_STEPS)[number]): string | null {
  switch (step) {
    case OrderStatus.PENDING_BAKERY:
      return order.createdAt;
    case OrderStatus.PREPARING:
      return order.timestamps.acceptedAt ?? null;
    case OrderStatus.READY:
      return order.timestamps.readyAt ?? null;
    case OrderStatus.IN_DELIVERY:
      return order.timestamps.pickedUpAt ?? null;
    case OrderStatus.DELIVERED:
      return order.timestamps.deliveredAt ?? null;
  }
}

function Timeline({ order }: { order: OrderView }) {
  const currentIndex = TIMELINE_STEPS.indexOf(
    order.status as (typeof TIMELINE_STEPS)[number],
  );
  return (
    <Card>
      {TIMELINE_STEPS.map((step, index) => {
        const done = currentIndex > index;
        const current = currentIndex === index;
        const ts = stepTimestamp(order, step);
        return (
          <View key={step} className="flex-row">
            {/* عمود المؤشر والخط الرابط */}
            <View className="items-center">
              <View
                className={cn(
                  'h-6 w-6 items-center justify-center rounded-full',
                  done && 'bg-status-delivered',
                  current && 'bg-brand-500',
                  !done && !current && 'bg-stone-300',
                )}
              >
                {done ? <Ionicons name="checkmark" size={14} color="#ffffff" /> : null}
              </View>
              {index < TIMELINE_STEPS.length - 1 ? (
                <View className={cn('w-0.5 flex-1', done ? 'bg-status-delivered' : 'bg-stone-200')} />
              ) : null}
            </View>
            <View className={cn('flex-1 pb-5 ps-3', index === TIMELINE_STEPS.length - 1 && 'pb-1')}>
              <AppText
                variant={current ? 'heading' : 'body'}
                className={cn(!done && !current && 'text-stone-400', current && 'text-brand-600')}
              >
                {t('order', STEP_LABEL_KEY[step])}
              </AppText>
              {ts ? (
                <AppText variant="caption" className="mt-0.5">
                  {formatTime(ts)}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

/** C-06/C-07: بانر النجاح + الخط الزمني + رمز التسليم + البنود + الإلغاء */
export default function OrderScreen() {
  const { id, placed } = useLocalSearchParams<{ id: string; placed?: string }>();
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const orderQuery = useOrderQuery(id);
  const order = orderQuery.data;

  const [cancelVisible, setCancelVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // socket تلميح: حدّث الحالة فوراً ثم أعد الجلب عبر REST (مصدر الحقيقة)
  useEffect(() => {
    if (!socket || !id) return;
    const handler = (e: { orderId: string; status: OrderStatus }) => {
      if (e.orderId !== id) return;
      queryClient.setQueryData<OrderView>(['order', id], (old) =>
        old ? { ...old, status: e.status } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['order', id] });
    };
    socket.on('order:status', handler);
    return () => {
      socket.off('order:status', handler);
    };
  }, [socket, id, queryClient]);

  const cancelOrder = useMutation({
    mutationFn: (reason: string) => api.post<OrderView>(`orders/${id}/cancel`, { reason }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['order', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      setCancelVisible(false);
      setCancelReason('');
    },
    onError: (error: unknown) => {
      setCancelVisible(false);
      Alert.alert(t('common', 'error'), apiErrorMessage(error) ?? t('common', 'error'));
      void orderQuery.refetch();
    },
  });

  const active = order ? isActiveOrder(order) : false;

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader title={t('customer', 'trackOrder')} />

      {orderQuery.isLoading ? (
        <LoadingState />
      ) : orderQuery.isError || !order ? (
        <ErrorState onRetry={() => void orderQuery.refetch()} />
      ) : (
        <ScrollView
          className="flex-1 px-4 pt-3"
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* C-06: بانر النجاح في أول زيارة بعد الإرسال */}
          {placed === '1' && order.status !== OrderStatus.CANCELLED ? (
            <Card className="mb-3 bg-status-delivered/10">
              <View className="flex-row items-center gap-2">
                <Ionicons name="checkmark-circle" size={26} color="#15803d" />
                <View className="flex-1">
                  <AppText variant="heading" className="text-status-delivered">
                    {t('customer', 'orderPlaced')}
                  </AppText>
                  <AppText variant="caption" className="mt-0.5">
                    {t('order', 'orderCode')}: {order.code} — {t('order', 'codNotice')}
                  </AppText>
                </View>
                <MoneyText amountIqd={order.totalIqd} className="text-status-delivered" />
              </View>
            </Card>
          ) : null}

          {/* رقم الطلب + الحالة (لون + نص، لا لون فقط) */}
          <Card className="mb-3">
            <View className="flex-row items-center justify-between">
              <View>
                <AppText variant="caption">{t('order', 'orderCode')}</AppText>
                <AppText variant="heading">{order.code}</AppText>
              </View>
              <StatusBadge status={order.status as OrderStatus} />
            </View>
            {order.status === OrderStatus.CANCELLED && order.cancelledReason ? (
              <AppText variant="caption" className="mt-2 text-status-cancelled">
                {t('customer', 'cancelledReasonLabel')}: {order.cancelledReason}
              </AppText>
            ) : null}
          </Card>

          {order.status !== OrderStatus.CANCELLED ? (
            <View className="mb-3">
              <Timeline order={order} />
            </View>
          ) : null}

          {/* رمز التسليم بارز ما دام الطلب نشطاً */}
          {active && order.deliveryPin ? (
            <Card className="mb-3 items-center bg-brand-50">
              <AppText variant="heading" className="text-brand-700">
                {t('order', 'deliveryPin')}
              </AppText>
              <PinOrQr
                kind={ScanKind.DELIVERY}
                id={order.id}
                pin={order.deliveryPin}
                className="my-1"
                labels={{ qr: t('common', 'scanQr'), pin: t('common', 'scanPin') }}
              />
              <AppText variant="caption" className="mt-2">
                {t('order', 'deliveryPinHint')}
              </AppText>
            </Card>
          ) : null}

          {/* البنود والمجاميع */}
          <Card className="mb-3">
            <AppText variant="heading" className="mb-2">
              {order.vendorNameAr}
            </AppText>
            {order.items.map((item) => (
              <View key={item.id} className="flex-row justify-between py-1">
                <AppText variant="caption" className="flex-1">
                  {item.productNameAr} × {item.quantity}
                </AppText>
                <MoneyText amountIqd={item.lineTotalIqd} />
              </View>
            ))}
            <View className="mt-2 border-t border-surface-muted pt-2">
              <View className="flex-row justify-between py-0.5">
                <AppText variant="caption">{t('order', 'subtotal')}</AppText>
                <MoneyText amountIqd={order.subtotalIqd} />
              </View>
              <View className="flex-row justify-between py-0.5">
                <AppText variant="caption">{t('order', 'deliveryFee')}</AppText>
                <MoneyText amountIqd={order.deliveryFeeIqd} />
              </View>
              <View className="flex-row justify-between py-0.5">
                <AppText variant="heading">{t('order', 'total')}</AppText>
                <MoneyText amountIqd={order.totalIqd} className="text-brand-600" />
              </View>
            </View>
            {order.note ? (
              <AppText variant="caption" className="mt-2">
                {t('order', 'note')}: {order.note}
              </AppText>
            ) : null}
          </Card>

          {/* الإلغاء متاح فقط قبل قبول المخبز (آلة الحالة §8.1) */}
          {order.status === OrderStatus.PENDING_BAKERY ? (
            <Button
              title={t('order', 'cancelOrder')}
              variant="danger"
              onPress={() => setCancelVisible(true)}
            />
          ) : null}
        </ScrollView>
      )}

      {/* حوار سبب الإلغاء */}
      <Modal
        visible={cancelVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelVisible(false)}
      >
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <Card className="w-full">
            <AppText variant="heading" className="mb-3">
              {t('order', 'cancelReason')}
            </AppText>
            <Input
              placeholder={t('customer', 'cancelReasonPlaceholder')}
              value={cancelReason}
              onChangeText={setCancelReason}
              multiline
            />
            <View className="mt-4 gap-2">
              <Button
                title={t('customer', 'confirmCancel')}
                variant="danger"
                loading={cancelOrder.isPending}
                disabled={cancelReason.trim().length < 2 || cancelOrder.isPending}
                onPress={() => cancelOrder.mutate(cancelReason.trim())}
              />
              <Button
                title={t('common', 'back')}
                variant="ghost"
                onPress={() => setCancelVisible(false)}
              />
            </View>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}
