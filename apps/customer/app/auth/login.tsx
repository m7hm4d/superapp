import { t } from '@superapp/i18n';
import type { AuthTokens, AuthUser } from '@superapp/shared';
import { isValidIraqiPhone, normalizeIraqiPhone } from '@superapp/shared';
import { AppText, Button, Input, Screen } from '@superapp/ui';
import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { api, apiErrorMessage, apiErrorStatus } from '../../src/lib/api';
import { toLocalPhone } from '../../src/lib/format';
import { useAuthStore } from '../../src/stores/auth';

interface AuthResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

/** تسجيل الدخول (هاتف + كلمة مرور) — يتسامح مع الأرقام العربية-الهندية */
export default function LoginScreen() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [phoneError, setPhoneError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const login = useMutation({
    mutationFn: async (input: { phone: string; password: string }) => {
      const res = await api.post<AuthResponse>('auth/login', input);
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
      setFormError(
        apiErrorStatus(error) === 401
          ? t('auth', 'wrongCredentials')
          : (apiErrorMessage(error) ?? t('common', 'error')),
      );
    },
  });

  const submit = () => {
    setFormError(undefined);
    if (!isValidIraqiPhone(phone)) {
      setPhoneError(t('auth', 'invalidPhone'));
      return;
    }
    setPhoneError(undefined);
    login.mutate({ phone: normalizeIraqiPhone(phone), password });
  };

  return (
    <Screen scroll={false} padded={false}>
      <ScreenHeader title={t('auth', 'login')} />
      <View className="flex-1 gap-3 px-4 pt-4">
        <Input
          label={t('auth', 'phone')}
          placeholder={t('auth', 'phonePlaceholder')}
          value={phone}
          onChangeText={(v) => setPhone(v)}
          onBlur={() => {
            // توحيد العرض إلى 07XXXXXXXXX إن كان الرقم صالحاً
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
          title={t('auth', 'login')}
          onPress={submit}
          loading={login.isPending}
          disabled={login.isPending || password.length === 0 || phone.length === 0}
        />

        <Pressable
          accessibilityRole="button"
          className="min-h-touch items-center justify-center"
          onPress={() =>
            router.replace({ pathname: '/auth/register', params: next ? { next } : undefined })
          }
        >
          <AppText variant="body" className="text-brand-600">
            {t('customer', 'noAccount')}
          </AppText>
        </Pressable>
      </View>
    </Screen>
  );
}
