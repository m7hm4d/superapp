import { t } from '@superapp/i18n';
import type { AuthTokens, AuthUser } from '@superapp/shared';
import { Role, isValidIraqiPhone, normalizeIraqiPhone } from '@superapp/shared';
import { AppText, Button, Input, Screen } from '@superapp/ui';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { api, apiErrorMessage } from '../../src/lib/api';
import { toLocalPhone } from '../../src/lib/format';
import { useAuthStore } from '../../src/stores/auth';

interface AuthResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

/** إنشاء حساب عميل: الاسم + الهاتف + كلمة المرور */
export default function RegisterScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const register = useMutation({
    mutationFn: async (input: {
      role: typeof Role.CUSTOMER;
      phone: string;
      password: string;
      fullName: string;
    }) => {
      const res = await api.post<AuthResponse>('auth/register', input);
      await api.storage.set(res.tokens);
      return res;
    },
    onSuccess: (res) => {
      useAuthStore.getState().setSession(res.user);
      if (next) {
        router.replace(next);
      } else {
        router.back();
      }
    },
    onError: (error: unknown) => {
      setFormError(apiErrorMessage(error) ?? t('common', 'error'));
    },
  });

  const submit = () => {
    setFormError(undefined);
    if (!isValidIraqiPhone(phone)) {
      setPhoneError(t('auth', 'invalidPhone'));
      return;
    }
    setPhoneError(undefined);
    register.mutate({
      role: Role.CUSTOMER,
      phone: normalizeIraqiPhone(phone),
      password,
      fullName: fullName.trim(),
    });
  };

  const valid = fullName.trim().length >= 2 && phone.length > 0 && password.length >= 8;

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader title={t('auth', 'register')} />
      <ScrollView
        className="flex-1 px-4 pt-4"
        contentContainerStyle={{ paddingBottom: 24, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <Input label={t('auth', 'fullName')} value={fullName} onChangeText={setFullName} />
        <Input
          label={t('auth', 'phone')}
          placeholder={t('auth', 'phonePlaceholder')}
          value={phone}
          onChangeText={setPhone}
          onBlur={() => {
            if (isValidIraqiPhone(phone)) setPhone(toLocalPhone(normalizeIraqiPhone(phone)));
          }}
          keyboardType="phone-pad"
          error={phoneError}
        />
        <Input
          label={t('auth', 'password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {formError ? (
          <AppText variant="caption" className="text-status-cancelled">
            {formError}
          </AppText>
        ) : null}

        <Button
          title={t('auth', 'register')}
          onPress={submit}
          loading={register.isPending}
          disabled={register.isPending || !valid}
        />

        <Pressable
          accessibilityRole="button"
          className="min-h-touch items-center justify-center"
          onPress={() =>
            router.replace({ pathname: '/auth/login', params: next ? { next } : undefined })
          }
        >
          <AppText variant="body" className="text-brand-600">
            {t('customer', 'haveAccount')}
          </AppText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
