import { t } from '@superapp/i18n';
import type { AuthTokens, AuthUser } from '@superapp/shared';
import { AppText, Button, Input, Screen } from '@superapp/ui';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { client, storage } from '../src/lib/api';
import { errorCode } from '../src/lib/errors';
import { useAuthStore } from '../src/stores/auth';

interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

export default function LoginScreen() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loginMutation = useMutation({
    mutationFn: () => client.post<LoginResponse>('auth/login', { phone, password }),
    onSuccess: async (res) => {
      await storage.set(res.tokens);
      setSession(res.user);
      // AuthGate يتكفل بالتوجيه (التبويبات أو شاشة التفعيل)
    },
    onError: (e) => {
      const code = errorCode(e);
      setError(
        code === 'INVALID_CREDENTIALS' ? t('auth', 'wrongCredentials') : t('common', 'error'),
      );
    },
  });

  const canSubmit = phone.trim().length >= 7 && password.length >= 1;

  return (
    <Screen scroll padded>
      <View className="mt-12 mb-8">
        <AppText variant="title">{t('common', 'appName')}</AppText>
        <AppText variant="heading" className="mt-2 text-neutral-600">
          {t('driver', 'loginTitle')}
        </AppText>
      </View>

      <Input
        label={t('auth', 'phone')}
        placeholder={t('auth', 'phonePlaceholder')}
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phone}
        onChangeText={(v) => {
          setPhone(v);
          setError(null);
        }}
      />
      <View className="mt-4">
        <Input
          label={t('auth', 'password')}
          secureTextEntry
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setError(null);
          }}
        />
      </View>

      {error ? (
        <AppText variant="caption" className="mt-3 text-status-cancelled">
          {error}
        </AppText>
      ) : null}

      <View className="mt-6">
        <Button
          title={t('auth', 'login')}
          onPress={() => loginMutation.mutate()}
          loading={loginMutation.isPending}
          disabled={!canSubmit || loginMutation.isPending}
        />
      </View>

      <Pressable
        className="mt-6 min-h-touch items-center justify-center"
        onPress={() => router.push('/register')}
      >
        <AppText variant="body" className="text-brand-600">
          {t('driver', 'noAccount')}
        </AppText>
      </Pressable>
    </Screen>
  );
}
