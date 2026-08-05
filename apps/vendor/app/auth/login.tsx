import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, Button, Input, Screen } from '@superapp/ui';
import { t } from '@superapp/i18n';
import { isValidIraqiPhone, type AuthTokens, type AuthUser } from '@superapp/shared';
import { api, apiErrorCode, apiErrorStatus, storage } from '../../src/lib/api';
import { useAuthStore } from '../../src/stores/auth';
import { useApprovalStore } from '../../src/stores/approval';

interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

export default function LoginScreen() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError(undefined);
    if (!isValidIraqiPhone(phone)) {
      setError(t('auth', 'invalidPhone'));
      return;
    }
    if (password.length === 0) {
      setError(t('common', 'required'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<LoginResponse>('auth/login', { phone, password });
      await storage.set(res.tokens);
      // بائع غير مفعّل بعد؟ ارفع علم الحجب ليوجّه البوابةُ إلى M-01
      const approval = res.user.approvalStatus;
      if (approval && approval !== 'approved') {
        useApprovalStore.getState().setBlocked({ status: approval });
      } else {
        useApprovalStore.getState().clear();
      }
      setSession(res.user);
    } catch (e) {
      const status = apiErrorStatus(e);
      const code = apiErrorCode(e);
      if (status === 401 || code === 'INVALID_CREDENTIALS') {
        setError(t('auth', 'wrongCredentials'));
      } else if (code === 'BLOCKED') {
        setError(t('auth', 'blocked'));
      } else {
        setError(t('common', 'error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll padded>
      <View className="flex-1 justify-center gap-6 py-10">
        <View className="gap-1">
          <AppText variant="title">{t('vendor', 'loginTitle')}</AppText>
          <AppText variant="caption">{t('common', 'appName')}</AppText>
        </View>
        <View className="gap-4">
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
            error={error}
          />
        </View>
        <Button title={t('auth', 'login')} loading={submitting} onPress={() => void submit()} />
        <Button
          title={t('auth', 'noAccount')}
          variant="ghost"
          onPress={() => router.push('/auth/register')}
        />
      </View>
    </Screen>
  );
}
