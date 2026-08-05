import { t } from '@superapp/i18n';
import { AppText, Button, Card, Screen } from '@superapp/ui';
import React from 'react';
import { View } from 'react-native';
import { approvalLabel, vehicleLabel } from '../../src/lib/labels';
import { logout, useAuthStore } from '../../src/stores/auth';

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between border-b border-neutral-100 py-3">
      <AppText variant="caption" className="text-neutral-500">
        {label}
      </AppText>
      <AppText variant="body">{value}</AppText>
    </View>
  );
}

/** D-10 — الحساب والمركبة والإعدادات */
export default function AccountScreen() {
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);

  return (
    <Screen scroll padded>
      <AppText variant="title" className="mt-2">
        {t('driver', 'tabAccount')}
      </AppText>

      <Card className="mt-4">
        <InfoRow label={t('auth', 'fullName')} value={user?.fullName ?? '—'} />
        <InfoRow label={t('auth', 'phone')} value={user?.phone ?? '—'} />
        <InfoRow
          label={t('driver', 'vehicleLabel')}
          value={profile ? vehicleLabel(profile.vehicleType) : '—'}
        />
        <InfoRow
          label={t('driver', 'approvalLabel')}
          value={profile ? approvalLabel(profile.approvalStatus) : '—'}
        />
      </Card>

      <View className="mt-6">
        <Button title={t('auth', 'logout')} variant="danger" onPress={() => void logout()} />
      </View>
    </Screen>
  );
}
