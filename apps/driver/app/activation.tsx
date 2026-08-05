import { t } from '@superapp/i18n';
import type { AuthUser } from '@superapp/shared';
import { ApprovalStatus } from '@superapp/shared';
import { AppText, Button, Card, LoadingState, Screen } from '@superapp/ui';
import { useQuery } from '@tanstack/react-query';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { client } from '../src/lib/api';
import { approvalLabel, vehicleLabel } from '../src/lib/labels';
import { logout, useAuthStore } from '../src/stores/auth';
import type { DriverProfile } from '../src/types';

interface MeResponse {
  user: AuthUser;
  profile: DriverProfile | null;
}

/** D-01 — حالة التسجيل/التفعيل: قيد المراجعة، مرفوض، أو موقوف */
export default function ActivationScreen() {
  const user = useAuthStore((s) => s.user);
  const setProfile = useAuthStore((s) => s.setProfile);

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => client.get<MeResponse>('auth/me'),
  });

  const profile = meQuery.data?.profile ?? null;
  const approvalStatus = profile?.approvalStatus ?? user?.approvalStatus ?? ApprovalStatus.PENDING;

  // عند الاعتماد: حدّث المخزن — AuthGate ينقل تلقائياً لشاشة العمل
  useEffect(() => {
    if (profile) setProfile(profile);
  }, [profile, setProfile]);

  if (meQuery.isPending && !user) return <LoadingState />;

  const isRejected = approvalStatus === ApprovalStatus.REJECTED;
  const isSuspended = approvalStatus === ApprovalStatus.SUSPENDED;

  return (
    <Screen scroll padded>
      <View className="mt-16 mb-6 items-center">
        <AppText variant="title">
          {isRejected
            ? t('auth', 'rejected')
            : isSuspended
              ? t('auth', 'blocked')
              : t('auth', 'pendingApproval')}
        </AppText>
        {!isRejected && !isSuspended ? (
          <AppText variant="body" className="mt-3 text-center text-neutral-600">
            {t('auth', 'pendingApprovalBody')}
          </AppText>
        ) : null}
        {isRejected && profile?.rejectionReason ? (
          <AppText variant="body" className="mt-3 text-center text-status-cancelled">
            {t('driver', 'rejectionReasonLabel')}: {profile.rejectionReason}
          </AppText>
        ) : null}
      </View>

      <Card className="mb-4">
        <View className="flex-row items-center justify-between py-2">
          <AppText variant="caption" className="text-neutral-500">
            {t('auth', 'fullName')}
          </AppText>
          <AppText variant="body">{user?.fullName ?? '—'}</AppText>
        </View>
        <View className="flex-row items-center justify-between py-2">
          <AppText variant="caption" className="text-neutral-500">
            {t('auth', 'phone')}
          </AppText>
          <AppText variant="body">{user?.phone ?? '—'}</AppText>
        </View>
        <View className="flex-row items-center justify-between py-2">
          <AppText variant="caption" className="text-neutral-500">
            {t('driver', 'vehicleLabel')}
          </AppText>
          <AppText variant="body">{profile ? vehicleLabel(profile.vehicleType) : '—'}</AppText>
        </View>
        <View className="flex-row items-center justify-between py-2">
          <AppText variant="caption" className="text-neutral-500">
            {t('driver', 'approvalLabel')}
          </AppText>
          <AppText variant="body">{approvalLabel(approvalStatus)}</AppText>
        </View>
      </Card>

      <Button
        title={t('driver', 'refreshStatus')}
        variant="secondary"
        loading={meQuery.isFetching}
        onPress={() => void meQuery.refetch()}
      />
      <View className="mt-3">
        <Button title={t('auth', 'logout')} variant="ghost" onPress={() => void logout()} />
      </View>
    </Screen>
  );
}
