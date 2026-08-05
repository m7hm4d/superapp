import React, { useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppText,
  Button,
  Card,
  ErrorState,
  LoadingState,
  MoneyText,
  PinInput,
  Screen,
} from '@superapp/ui';
import { t } from '@superapp/i18n';
import { api, apiErrorCode } from '../src/lib/api';
import type { VendorLedgerResponse } from '../src/lib/types';
import { ScreenHeader } from '../src/components/screen-header';
import { ReasonDialog } from '../src/components/dialogs';

/**
 * M-07 تأكيد التسوية (مسار Modal يستقبل id):
 * إدخال PIN الظاهر عند السائق → تأكيد، أو فتح نزاع بسبب.
 */
export default function SettlementConfirmScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [pinKey, setPinKey] = useState(0);
  const [pinError, setPinError] = useState<string | undefined>();
  const [disputeOpen, setDisputeOpen] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;

  const ledger = useQuery({
    queryKey: ['vendor-ledger'],
    queryFn: () => api.get<VendorLedgerResponse>('vendor/ledger'),
  });
  const settlement = ledger.data?.settlements?.find((s) => s.id === id);

  const runShake = () => {
    shake.setValue(0);
    Animated.sequence([
      Animated.timing(shake, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['vendor-ledger'] });
    router.back();
  };

  const confirm = useMutation({
    mutationFn: (pin: string) => api.post(`vendor/settlements/${id}/confirm`, { pin }),
    onSuccess: done,
    onError: (e) => {
      if (apiErrorCode(e) === 'WRONG_PIN') {
        setPinError(t('vendor', 'wrongPin'));
        setPinKey((k) => k + 1); // إعادة تصفير حقل الرمز
        runShake();
      } else {
        setPinError(t('common', 'error'));
      }
    },
  });

  const dispute = useMutation({
    mutationFn: (reason: string) => api.post(`vendor/settlements/${id}/dispute`, { reason }),
    onSuccess: () => {
      setDisputeOpen(false);
      done();
    },
    onError: () => {
      setDisputeOpen(false);
      setPinError(t('common', 'error'));
    },
  });

  return (
    <Screen>
      <ScreenHeader title={t('vendor', 'confirmSettlement')} />
      {ledger.isPending ? (
        <LoadingState />
      ) : ledger.isError || !settlement ? (
        <ErrorState onRetry={() => void ledger.refetch()} />
      ) : (
        <View className="flex-1 p-4 gap-5">
          <Card className="items-center gap-2 py-6">
            <AppText variant="caption">{t('vendor', 'driverLabel')}</AppText>
            <AppText variant="heading">{settlement.driverName}</AppText>
            <MoneyText amountIqd={settlement.amountIqd} className="text-brand-700" />
            <AppText variant="caption">
              {t('vendor', 'ordersCount', { count: settlement.orderIds.length })}
            </AppText>
          </Card>

          <View className="gap-3">
            <AppText variant="body" className="text-center">
              {t('vendor', 'settlementPinPrompt')}
            </AppText>
            <Animated.View style={{ transform: [{ translateX: shake }] }}>
              <PinInput
                key={pinKey}
                length={4}
                onFilled={(pin) => {
                  setPinError(undefined);
                  confirm.mutate(pin);
                }}
              />
            </Animated.View>
            {pinError ? (
              <AppText variant="caption" className="text-status-cancelled text-center">
                {pinError}
              </AppText>
            ) : null}
            {confirm.isPending ? <LoadingState /> : null}
          </View>

          <View className="mt-auto gap-2 pb-4">
            <Button
              title={t('vendor', 'dispute')}
              variant="danger"
              onPress={() => setDisputeOpen(true)}
            />
            <Button title={t('common', 'cancel')} variant="ghost" onPress={() => router.back()} />
          </View>
        </View>
      )}

      <ReasonDialog
        visible={disputeOpen}
        title={t('vendor', 'dispute')}
        placeholder={t('vendor', 'disputeReasonPlaceholder')}
        submitTitle={t('vendor', 'dispute')}
        loading={dispute.isPending}
        onSubmit={(reason) => dispute.mutate(reason)}
        onCancel={() => setDisputeOpen(false)}
      />
    </Screen>
  );
}
