import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AppText,
  Button,
  Card,
  ErrorState,
  Input,
  LoadingState,
  Screen,
} from '@superapp/ui';
import { t } from '@superapp/i18n';
import { api, logout } from '../../src/lib/api';
import { useAuthStore } from '../../src/stores/auth';
import type { VendorProfileView } from '../../src/lib/types';

/** M-08 حالة المتجر وإعداداته + قسم الحساب */
export default function StoreScreen() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const profile = useQuery({
    queryKey: ['vendor-profile'],
    queryFn: () => api.get<VendorProfileView>('vendor/profile'),
  });

  const [storeNameAr, setStoreNameAr] = useState('');
  const [addressText, setAddressText] = useState('');
  const [defaultPrep, setDefaultPrep] = useState('');
  const [openingHours, setOpeningHours] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  // تعبئة النموذج أول مرة تصل فيها البيانات (بلا الدوران في حلقة تحديث)
  useEffect(() => {
    if (profile.data && !seeded) {
      setStoreNameAr(profile.data.storeNameAr);
      setAddressText(profile.data.addressText);
      setDefaultPrep(String(profile.data.defaultPrepMinutes));
      setOpeningHours(profile.data.openingHours ?? '');
      setSeeded(true);
    }
  }, [profile.data, seeded]);

  const prepMinutes = Number.parseInt(defaultPrep, 10);
  const prepValid = Number.isFinite(prepMinutes) && prepMinutes >= 1 && prepMinutes <= 180;
  const nameValid = storeNameAr.trim().length >= 2;
  const addressValid = addressText.trim().length >= 2;

  const save = useMutation({
    mutationFn: () =>
      api.patch('vendor/profile', {
        storeNameAr: storeNameAr.trim(),
        addressText: addressText.trim(),
        defaultPrepMinutes: prepMinutes,
        openingHours: openingHours.trim() || undefined,
      }),
    onSuccess: () => {
      setSaved(true);
      setError(false);
      void queryClient.invalidateQueries({ queryKey: ['vendor-profile'] });
      setTimeout(() => setSaved(false), 2500);
    },
    onError: () => setError(true),
  });

  return (
    <Screen>
      <View className="px-4 pt-4 pb-2">
        <AppText variant="title">{t('vendor', 'tabStore')}</AppText>
      </View>
      {profile.isPending ? (
        <LoadingState />
      ) : profile.isError ? (
        <ErrorState onRetry={() => void profile.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={profile.isRefetching}
              onRefresh={() => void profile.refetch()}
            />
          }
        >
          <Card className="gap-4">
            <AppText variant="heading">{t('vendor', 'storeSettings')}</AppText>
            <Input
              label={t('vendor', 'storeNameLabel')}
              value={storeNameAr}
              onChangeText={setStoreNameAr}
              error={!nameValid && seeded ? t('common', 'required') : undefined}
            />
            <Input
              label={t('vendor', 'addressLabel')}
              value={addressText}
              onChangeText={setAddressText}
              error={!addressValid && seeded ? t('common', 'required') : undefined}
            />
            <Input
              label={t('vendor', 'defaultPrepLabel')}
              keyboardType="number-pad"
              value={defaultPrep}
              onChangeText={setDefaultPrep}
              error={!prepValid && seeded ? t('common', 'required') : undefined}
            />
            <Input
              label={t('vendor', 'openingHoursLabel')}
              placeholder={t('vendor', 'openingHoursPlaceholder')}
              value={openingHours}
              onChangeText={setOpeningHours}
            />
            {saved ? (
              <AppText variant="caption" className="text-status-delivered">
                {t('vendor', 'profileSaved')}
              </AppText>
            ) : null}
            {error ? (
              <AppText variant="caption" className="text-status-cancelled">
                {t('common', 'error')}
              </AppText>
            ) : null}
            <Button
              title={t('common', 'save')}
              loading={save.isPending}
              disabled={!nameValid || !addressValid || !prepValid}
              onPress={() => save.mutate()}
            />
          </Card>

          {/* الحساب */}
          <Card className="gap-3 mb-8">
            <AppText variant="heading">{t('vendor', 'accountTitle')}</AppText>
            {user ? (
              <View className="gap-1">
                <AppText variant="body">{user.fullName}</AppText>
                <AppText variant="caption">{user.phone}</AppText>
              </View>
            ) : null}
            <Button
              title={t('auth', 'logout')}
              variant="danger"
              onPress={() => void logout()}
            />
          </Card>
        </ScrollView>
      )}
    </Screen>
  );
}
