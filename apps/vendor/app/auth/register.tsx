import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppText, Button, Chip, Input, Screen } from '@superapp/ui';
import { t } from '@superapp/i18n';
import {
  VendorCategory,
  isValidIraqiPhone,
  type AuthTokens,
  type AuthUser,
} from '@superapp/shared';
import { api, apiErrorCode, apiErrorMessage, storage } from '../../src/lib/api';
import { useAuthStore } from '../../src/stores/auth';
import { useApprovalStore } from '../../src/stores/approval';

interface ConfigResponse {
  city?: { centerLat: number; centerLng: number };
}

interface RegisterResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

const CATEGORY_LABEL_KEY = {
  [VendorCategory.BAKERY]: 'category_bakery',
  [VendorCategory.VEGETABLES]: 'category_vegetables',
  [VendorCategory.MARKET]: 'category_market',
  [VendorCategory.CONSTRUCTION]: 'category_construction',
} as const;

export default function RegisterScreen() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const config = useQuery({
    queryKey: ['config'],
    queryFn: () => api.get<ConfigResponse>('config'),
  });

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [storeNameAr, setStoreNameAr] = useState('');
  const [category, setCategory] = useState<VendorCategory>(VendorCategory.BAKERY);
  const [addressText, setAddressText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(undefined);
    if (fullName.trim().length < 2 || storeNameAr.trim().length < 2 || addressText.trim().length < 2) {
      setError(t('common', 'required'));
      return;
    }
    if (!isValidIraqiPhone(phone)) {
      setError(t('auth', 'invalidPhone'));
      return;
    }
    if (password.length < 8) {
      setError(t('auth', 'passwordMin'));
      return;
    }
    const city = config.data?.city;
    const location = city
      ? { lat: city.centerLat, lng: city.centerLng }
      : { lat: 33.3152, lng: 44.3661 };
    setSubmitting(true);
    try {
      const res = await api.post<RegisterResponse>('auth/register', {
        role: 'vendor',
        phone,
        password,
        fullName: fullName.trim(),
        storeNameAr: storeNameAr.trim(),
        category,
        location,
        addressText: addressText.trim(),
      });
      await storage.set(res.tokens);
      const approval = res.user.approvalStatus ?? 'pending';
      if (approval !== 'approved') {
        useApprovalStore.getState().setBlocked({ status: approval });
      }
      setSession(res.user);
    } catch (e) {
      setError(apiErrorCode(e) ? (apiErrorMessage(e) ?? t('common', 'error')) : t('common', 'error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll padded>
      <View className="gap-6 py-10">
        <View className="gap-1">
          <AppText variant="title">{t('vendor', 'registerTitle')}</AppText>
          <AppText variant="caption">{t('vendor', 'registerHint')}</AppText>
        </View>
        <View className="gap-4">
          <Input label={t('auth', 'fullName')} value={fullName} onChangeText={setFullName} />
          <Input
            label={t('auth', 'phone')}
            placeholder={t('auth', 'phonePlaceholder')}
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />
          <Input
            label={t('auth', 'password')}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Input
            label={t('vendor', 'storeNameLabel')}
            value={storeNameAr}
            onChangeText={setStoreNameAr}
          />
          <View className="gap-2">
            <AppText variant="caption">{t('vendor', 'categoryLabel')}</AppText>
            <View className="flex-row flex-wrap gap-2">
              {Object.values(VendorCategory).map((c) => (
                <Chip
                  key={c}
                  label={t('vendor', CATEGORY_LABEL_KEY[c])}
                  selected={category === c}
                  onPress={() => setCategory(c)}
                />
              ))}
            </View>
          </View>
          <Input
            label={t('vendor', 'addressLabel')}
            value={addressText}
            onChangeText={setAddressText}
          />
          <AppText variant="caption">{t('vendor', 'locationNote')}</AppText>
          {error ? (
            <AppText variant="caption" className="text-status-cancelled">
              {error}
            </AppText>
          ) : null}
        </View>
        <Button title={t('auth', 'register')} loading={submitting} onPress={() => void submit()} />
        <Button title={t('auth', 'haveAccount')} variant="ghost" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
