import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppText,
  Button,
  Card,
  Chip,
  ErrorState,
  Input,
  LoadingState,
  MoneyText,
  Screen,
  StatusBadge,
} from '@superapp/ui';
import { t } from '@superapp/i18n';
import { OrderStatus, type OrderView } from '@superapp/shared';
import { api, apiErrorCode, apiErrorStatus } from '../../src/lib/api';
import { asArray } from '../../src/lib/types';
import { ScreenHeader } from '../../src/components/screen-header';
import { ConfirmDialog, ReasonDialog } from '../../src/components/dialogs';

const QUICK_PREP = [10, 15, 20, 30] as const;

/** جلب تفاصيل الطلب: orders/:id أولاً، وعند المنع نبحث في طوابير البائع */
async function fetchOrder(id: string): Promise<OrderView> {
  try {
    return await api.get<OrderView>(`orders/${id}`);
  } catch (e) {
    const status = apiErrorStatus(e);
    if (status !== 403 && status !== 404) throw e;
    for (const st of ['new', 'preparing', 'ready', 'history']) {
      const list = asArray<OrderView>(await api.get<unknown>('vendor/orders', { status: st }), 'orders');
      const found = list.find((o) => o.id === id);
      if (found) return found;
    }
    throw e;
  }
}

/** M-03 تفاصيل وتنفيذ الطلب */
export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [prepMinutes, setPrepMinutes] = useState<number>(15);
  const [customPrep, setCustomPrep] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);

  const query = useQuery({
    queryKey: ['vendor-order', id],
    queryFn: () => fetchOrder(id),
    enabled: Boolean(id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['vendor-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['vendor-order', id] });
  };

  /** §11 حالة التعارض: نعرض الحوار ونعيد الجلب قبل السماح بالتكرار */
  const handleActionError = (e: unknown) => {
    const code = apiErrorCode(e);
    if (code === 'VERSION_CONFLICT' || code === 'ILLEGAL_TRANSITION' || apiErrorStatus(e) === 409) {
      setConflictOpen(true);
      invalidate();
    }
  };

  const accept = useMutation({
    mutationFn: (vars: { prepMinutes: number; expectedVersion: number }) =>
      api.post(`vendor/orders/${id}/accept`, vars),
    onSuccess: invalidate,
    onError: handleActionError,
  });

  const reject = useMutation({
    mutationFn: (vars: { reason: string; expectedVersion: number }) =>
      api.post(`vendor/orders/${id}/reject`, vars),
    onSuccess: () => {
      setRejectOpen(false);
      invalidate();
      router.back();
    },
    onError: (e) => {
      setRejectOpen(false);
      handleActionError(e);
    },
  });

  const ready = useMutation({
    mutationFn: (vars: { expectedVersion: number }) => api.post(`vendor/orders/${id}/ready`, vars),
    onSuccess: invalidate,
    onError: handleActionError,
  });

  const order = query.data;
  const effectivePrep = customPrep.trim().length > 0 ? Number.parseInt(customPrep, 10) : prepMinutes;
  const prepValid = Number.isFinite(effectivePrep) && effectivePrep >= 1 && effectivePrep <= 180;

  return (
    <Screen>
      <ScreenHeader title={order ? `${t('order', 'orderCode')} ${order.code}` : t('order', 'orderCode')} />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError || !order ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <View className="gap-4 pb-8">
            <View className="flex-row items-center justify-between">
              <AppText variant="heading" selectable>
                {order.code}
              </AppText>
              <StatusBadge status={order.status as OrderStatus} />
            </View>

            {/* البنود */}
            <Card className="gap-3">
              {order.items.map((item) => (
                <View key={item.id} className="flex-row items-center justify-between gap-2">
                  <AppText variant="body" className="flex-1">
                    {item.productNameAr} ×{item.quantity}
                  </AppText>
                  <MoneyText amountIqd={item.lineTotalIqd} />
                </View>
              ))}
              <View className="border-t border-surface-muted pt-3 gap-1">
                <View className="flex-row justify-between">
                  <AppText variant="caption">{t('order', 'subtotal')}</AppText>
                  <MoneyText amountIqd={order.subtotalIqd} />
                </View>
                <View className="flex-row justify-between">
                  <AppText variant="caption">{t('order', 'deliveryFee')}</AppText>
                  <MoneyText amountIqd={order.deliveryFeeIqd} />
                </View>
                <View className="flex-row justify-between">
                  <AppText variant="heading">{t('order', 'total')}</AppText>
                  <MoneyText amountIqd={order.totalIqd} className="text-brand-700" />
                </View>
              </View>
            </Card>

            {/* ملاحظة الزبون وعنوان التوصيل */}
            {order.note ? (
              <Card className="gap-1">
                <AppText variant="caption">{t('vendor', 'customerNote')}</AppText>
                <AppText variant="body">{order.note}</AppText>
              </Card>
            ) : null}
            <Card className="gap-1">
              <AppText variant="caption">{t('vendor', 'deliveryAddress')}</AppText>
              <AppText variant="body">{order.deliveryAddressText}</AppText>
              {order.deliveryLandmark ? (
                <AppText variant="caption">
                  {t('vendor', 'landmarkLabel')}: {order.deliveryLandmark}
                </AppText>
              ) : null}
            </Card>

            {/* الأفعال حسب الحالة */}
            {order.status === OrderStatus.PENDING_BAKERY ? (
              <Card className="gap-4">
                <AppText variant="heading">{t('vendor', 'prepTime')}</AppText>
                <View className="flex-row flex-wrap gap-2">
                  {QUICK_PREP.map((m) => (
                    <Chip
                      key={m}
                      label={`${m}`}
                      selected={customPrep.trim().length === 0 && prepMinutes === m}
                      onPress={() => {
                        setPrepMinutes(m);
                        setCustomPrep('');
                      }}
                    />
                  ))}
                </View>
                <Input
                  label={t('vendor', 'prepCustom')}
                  keyboardType="number-pad"
                  value={customPrep}
                  onChangeText={setCustomPrep}
                  error={customPrep.trim().length > 0 && !prepValid ? t('common', 'required') : undefined}
                />
                <Button
                  title={t('vendor', 'acceptOrder')}
                  loading={accept.isPending}
                  disabled={!prepValid || reject.isPending}
                  onPress={() =>
                    accept.mutate({ prepMinutes: effectivePrep, expectedVersion: order.version })
                  }
                />
                <Button
                  title={t('vendor', 'rejectOrder')}
                  variant="danger"
                  disabled={accept.isPending}
                  onPress={() => setRejectOpen(true)}
                />
              </Card>
            ) : null}

            {order.status === OrderStatus.PREPARING ? (
              <Button
                title={t('vendor', 'markReady')}
                loading={ready.isPending}
                onPress={() => ready.mutate({ expectedVersion: order.version })}
              />
            ) : null}

            {order.status === OrderStatus.READY ? (
              <Card className="gap-2 items-center py-6">
                <AppText variant="heading">{t('vendor', 'waitingDriver')}</AppText>
                <AppText variant="caption" className="text-center">
                  {t('vendor', 'pickupPinHint')}
                </AppText>
              </Card>
            ) : null}

            {order.status === OrderStatus.CANCELLED && order.cancelledReason ? (
              <Card className="gap-1">
                <AppText variant="caption">{t('order', 'cancelReason')}</AppText>
                <AppText variant="body">{order.cancelledReason}</AppText>
              </Card>
            ) : null}
          </View>
        </ScrollView>
      )}

      {/* رفض بسبب إلزامي */}
      <ReasonDialog
        visible={rejectOpen}
        title={t('vendor', 'rejectOrder')}
        placeholder={t('vendor', 'rejectReasonPlaceholder')}
        submitTitle={t('vendor', 'rejectOrder')}
        loading={reject.isPending}
        onSubmit={(reason) =>
          order ? reject.mutate({ reason, expectedVersion: order.version }) : undefined
        }
        onCancel={() => setRejectOpen(false)}
      />

      {/* §11 تعارض النسخ */}
      <ConfirmDialog
        visible={conflictOpen}
        title={t('vendor', 'conflictTitle')}
        body={t('vendor', 'conflictBody')}
        confirmTitle={t('common', 'close')}
        onConfirm={() => setConflictOpen(false)}
        onCancel={() => setConflictOpen(false)}
      />
    </Screen>
  );
}
