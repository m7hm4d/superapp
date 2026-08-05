import { formatDate, t } from '@superapp/i18n';
import type { SettlementView } from '@superapp/shared';
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Alert, Modal, View } from 'react-native';
import { client } from '../../src/lib/api';
import { settlementStatusLabel } from '../../src/lib/labels';
import { ledgerKey, useDriverLedger } from '../../src/lib/queries';

function SettlementModal({
  settlement,
  settled,
  onClose,
}: {
  settlement: SettlementView;
  settled: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-sheet bg-surface p-5 pb-8">
          <AppText variant="title" className="text-center">
            {t('driver', 'startSettlement')}
          </AppText>
          <AppText variant="body" className="mt-1 text-center text-neutral-600">
            {settlement.vendorNameAr}
          </AppText>

          <View className="mt-5 items-center rounded-card bg-surface-muted p-4">
            <AppText variant="caption" className="text-neutral-500">
              {t('driver', 'settlementAmount')}
            </AppText>
            <MoneyText amountIqd={settlement.amountIqd} className="text-3xl" />
          </View>

          {settled ? (
            <View className="mt-6 items-center">
              <AppText variant="title" className="text-status-delivered">
                {t('driver', 'settlementSettled')}
              </AppText>
            </View>
          ) : (
            <View className="mt-6 items-center">
              <AppText variant="body" className="text-neutral-600">
                {t('driver', 'settlementPinHint')}
              </AppText>
              <AppText
                variant="title"
                className="mt-3 text-5xl tracking-widest text-brand-700"
              >
                {settlement.settlementPin ?? '----'}
              </AppText>
              <AppText variant="caption" className="mt-4 text-neutral-500">
                {t('driver', 'settlementWaiting')}
              </AppText>
              <LoadingState />
            </View>
          )}

          <View className="mt-6">
            <Button title={t('common', 'close')} variant="secondary" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** D-08 — سجل COD: العهدة النقدية، مستحق كل مخبز، والتسويات بـPIN */
export default function CashScreen() {
  const queryClient = useQueryClient();
  const [activeSettlement, setActiveSettlement] = useState<SettlementView | null>(null);
  const [pendingVendorId, setPendingVendorId] = useState<string | null>(null);

  // أثناء فتح لوحة التسوية: استطلاع كل 5 ثوانٍ حتى تأكيد المخبز
  const ledgerQuery = useDriverLedger(activeSettlement ? 5_000 : false);

  const currentSettlement = activeSettlement
    ? (ledgerQuery.data?.settlements.find((s) => s.id === activeSettlement.id) ?? activeSettlement)
    : null;
  const settled = currentSettlement?.status === 'SETTLED';

  const initiateMutation = useMutation({
    mutationFn: (vendorId: string) =>
      client.post<SettlementView>('driver/settlements', { vendorId }),
    onSuccess: (settlement) => {
      setPendingVendorId(null);
      setActiveSettlement(settlement);
      void queryClient.invalidateQueries({ queryKey: ledgerKey });
    },
    onError: () => {
      setPendingVendorId(null);
      Alert.alert(t('common', 'error'));
    },
  });

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

  return (
    <Screen scroll padded>
      <AppText variant="title" className="mt-2">
        {t('driver', 'tabCash')}
      </AppText>

      <Card className="mt-4 items-center bg-brand-50">
        <AppText variant="body" className="text-neutral-600">
          {t('driver', 'cashOnHand')}
        </AppText>
        <MoneyText amountIqd={ledger.cashOnHandIqd} className="mt-1 text-4xl text-brand-700" />
      </Card>

      <View className="mt-3 flex-row gap-3">
        <Card className="flex-1 items-center">
          <AppText variant="caption" className="text-neutral-500">
            {t('driver', 'todayEarnings')}
          </AppText>
          <MoneyText amountIqd={ledger.todayFeesIqd} className="mt-1" />
        </Card>
        <Card className="flex-1 items-center">
          <AppText variant="caption" className="text-neutral-500">
            {t('driver', 'todayDelivered')}
          </AppText>
          <AppText variant="heading" className="mt-1">
            {ledger.todayDeliveredCount}
          </AppText>
        </Card>
      </View>

      <AppText variant="heading" className="mt-6 mb-3">
        {t('driver', 'youOwe')}
      </AppText>
      {ledger.owed.length === 0 ? (
        <Card>
          <AppText variant="body" className="text-center text-neutral-500">
            {t('driver', 'noOwed')}
          </AppText>
        </Card>
      ) : (
        ledger.owed.map((row) => (
          <Card key={row.vendorId} className="mb-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <AppText variant="heading">{row.storeNameAr}</AppText>
                <AppText variant="caption" className="mt-1 text-neutral-500">
                  {t('driver', 'ordersCount', { count: row.orderIds.length })}
                </AppText>
              </View>
              <View className="items-end">
                <AppText variant="caption" className="text-neutral-500">
                  {t('driver', 'owedLabel')}
                </AppText>
                <MoneyText amountIqd={row.amountIqd} />
              </View>
            </View>
            <View className="mt-3">
              <Button
                title={t('driver', 'startSettlement')}
                variant="secondary"
                loading={initiateMutation.isPending && pendingVendorId === row.vendorId}
                disabled={initiateMutation.isPending}
                onPress={() => {
                  setPendingVendorId(row.vendorId);
                  initiateMutation.mutate(row.vendorId);
                }}
              />
            </View>
          </Card>
        ))
      )}

      <AppText variant="heading" className="mt-6 mb-3">
        {t('driver', 'settlementsHistory')}
      </AppText>
      {ledger.settlements.length === 0 ? (
        <EmptyState title={t('common', 'emptyGeneric')} />
      ) : (
        ledger.settlements.map((s) => (
          <Card key={s.id} className="mb-3">
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <AppText variant="body">{s.vendorNameAr}</AppText>
                <AppText variant="caption" className="mt-1 text-neutral-500">
                  {formatDate(s.createdAt)} — {settlementStatusLabel(s.status)}
                </AppText>
              </View>
              <MoneyText amountIqd={s.amountIqd} />
            </View>
          </Card>
        ))
      )}

      {currentSettlement ? (
        <SettlementModal
          settlement={currentSettlement}
          settled={settled}
          onClose={() => {
            setActiveSettlement(null);
            void queryClient.invalidateQueries({ queryKey: ledgerKey });
          }}
        />
      ) : null}
    </Screen>
  );
}
