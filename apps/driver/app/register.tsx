import { t } from '@superapp/i18n';
import type { AuthTokens, AuthUser } from '@superapp/shared';
import { VehicleType } from '@superapp/shared';
import { AppText, Button, Chip, Input, Screen } from '@superapp/ui';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { client, storage } from '../src/lib/api';
import { errorCode } from '../src/lib/errors';
import { vehicleLabel } from '../src/lib/labels';
import { useAuthStore } from '../src/stores/auth';

interface RegisterResponse {
  user: AuthUser;
  tokens: AuthTokens;
}

const VEHICLE_TYPES: VehicleType[] = [
  VehicleType.MOTORCYCLE,
  VehicleType.CAR,
  VehicleType.TUKTUK,
];

export default function RegisterScreen() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>(VehicleType.MOTORCYCLE);
  const [error, setError] = useState<string | null>(null);

  const registerMutation = useMutation({
    mutationFn: () =>
      client.post<RegisterResponse>('auth/register', {
        role: 'driver',
        phone,
        password,
        fullName,
        vehicleType,
      }),
    onSuccess: async (res) => {
      await storage.set(res.tokens);
      setSession(res.user);
      // حساب جديد يكون قيد المراجعة — AuthGate يحوله لشاشة التفعيل
    },
    onError: (e) => {
      const code = errorCode(e);
      if (code === 'PHONE_EXISTS') setError(t('auth', 'invalidPhone'));
      else setError(t('common', 'error'));
    },
  });

  const canSubmit = fullName.trim().length >= 2 && phone.trim().length >= 7 && password.length >= 8;

  return (
    <Screen scroll padded>
      <View className="mt-12 mb-8">
        <AppText variant="title">{t('driver', 'registerTitle')}</AppText>
      </View>

      <Input
        label={t('auth', 'fullName')}
        value={fullName}
        onChangeText={(v) => {
          setFullName(v);
          setError(null);
        }}
      />
      <View className="mt-4">
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
      </View>
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

      <AppText variant="body" className="mt-5 mb-2">
        {t('driver', 'vehicleLabel')}
      </AppText>
      <View className="flex-row flex-wrap gap-2">
        {VEHICLE_TYPES.map((type) => (
          <Chip
            key={type}
            label={vehicleLabel(type)}
            selected={vehicleType === type}
            onPress={() => setVehicleType(type)}
          />
        ))}
      </View>

      {error ? (
        <AppText variant="caption" className="mt-3 text-status-cancelled">
          {error}
        </AppText>
      ) : null}

      <View className="mt-6">
        <Button
          title={t('auth', 'register')}
          onPress={() => registerMutation.mutate()}
          loading={registerMutation.isPending}
          disabled={!canSubmit || registerMutation.isPending}
        />
      </View>

      <Pressable
        className="mt-6 min-h-touch items-center justify-center"
        onPress={() => router.back()}
      >
        <AppText variant="body" className="text-brand-600">
          {t('driver', 'hasAccount')}
        </AppText>
      </Pressable>
    </Screen>
  );
}
