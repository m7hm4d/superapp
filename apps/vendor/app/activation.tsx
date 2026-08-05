import React, { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, Screen } from '@superapp/ui';
import { t } from '@superapp/i18n';
import type { AuthUser } from '@superapp/shared';
import { api, logout } from '../src/lib/api';
import { useAuthStore } from '../src/stores/auth';
import { useApprovalStore } from '../src/stores/approval';

interface MeResponse {
  user: AuthUser;
  profile?: {
    approvalStatus?: string;
    rejectionReason?: string | null;
  };
}

/**
 * M-01 حالة التفعيل: قيد المراجعة / مرفوض مع سبب / موقوف.
 * زر تحديث يعيد فحص auth/me؛ عند الموافقة تُفتح التبويبات تلقائياً.
 */
export default function ActivationScreen() {
  const status = useApprovalStore((s) => s.status) ?? 'pending';
  const reason = useApprovalStore((s) => s.reason);
  const setSession = useAuthStore((s) => s.setSession);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(false);

  const refresh = async () => {
    setChecking(true);
    setCheckError(false);
    try {
      const me = await api.get<MeResponse>('auth/me');
      setSession(me.user);
      const current = me.profile?.approvalStatus ?? me.user.approvalStatus;
      if (!current || current === 'approved') {
        // انتهى الحجب — بوابة التوجيه في الجذر ستنقل إلى (tabs)
        useApprovalStore.getState().clear();
      } else {
        useApprovalStore.getState().setBlocked({
          status: current,
          reason: me.profile?.rejectionReason ?? undefined,
        });
      }
    } catch {
      setCheckError(true);
    } finally {
      setChecking(false);
    }
  };

  const isRejected = status === 'rejected';
  const isSuspended = status === 'suspended';
  const title = isRejected
    ? t('auth', 'rejected')
    : isSuspended
      ? t('auth', 'blocked')
      : t('auth', 'pendingApproval');
  const body = isRejected || isSuspended ? t('vendor', 'suspendedBody') : t('auth', 'pendingApprovalBody');

  return (
    <Screen padded>
      <View className="flex-1 justify-center gap-6">
        <Card className="gap-3 items-center py-8">
          <AppText variant="title">{title}</AppText>
          <AppText variant="body" className="text-center">
            {body}
          </AppText>
          {reason ? (
            <View className="gap-1 items-center">
              <AppText variant="caption">{t('vendor', 'rejectionReasonLabel')}</AppText>
              <AppText variant="body" className="text-status-cancelled text-center">
                {reason}
              </AppText>
            </View>
          ) : null}
          {checkError ? (
            <AppText variant="caption" className="text-status-cancelled">
              {t('common', 'error')}
            </AppText>
          ) : null}
        </Card>
        <View className="gap-2">
          <Button
            title={t('vendor', 'checkStatus')}
            loading={checking}
            onPress={() => void refresh()}
          />
          <Button title={t('auth', 'logout')} variant="ghost" onPress={() => void logout()} />
        </View>
      </View>
    </Screen>
  );
}
