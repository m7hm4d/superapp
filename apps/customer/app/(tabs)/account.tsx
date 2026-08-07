import { t } from '@superapp/i18n';
import { AppText, Button, Card, EmptyState, Screen } from '@superapp/ui';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { api } from '../../src/lib/api';
import { toLocalPhone } from '../../src/lib/format';
import { useAuthStore } from '../../src/stores/auth';

/** C-11 الحساب: ضيف → دخول/تسجيل؛ مسجّل → الاسم والهاتف والخروج + الإصدار */
export default function AccountScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const authStatus = useAuthStore((s) => s.status);

  const logout = async () => {
    // ‏api.logout يُبطل الجلسة على الخادم ثم يمسح المخزن — المسح وحده
    // كان يترك رمز التحديث صالحاً بعد «الخروج».
    await api.logout();
    useAuthStore.getState().setLoggedOut();
  };

  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <Screen scroll={false} padded={false}>
      <View className="bg-surface px-4 py-3">
        <AppText variant="title">{t('customer', 'tabAccount')}</AppText>
      </View>

      {authStatus !== 'authed' || !user ? (
        <View className="flex-1">
          <EmptyState title={t('customer', 'guestTitle')} body={t('customer', 'guestBody')} />
          <View className="gap-2 px-4 pb-8">
            <Button title={t('auth', 'login')} onPress={() => router.push('/auth/login')} />
            <Button
              title={t('auth', 'register')}
              variant="secondary"
              onPress={() => router.push('/auth/register')}
            />
          </View>
        </View>
      ) : (
        <View className="flex-1 px-4 pt-3">
          <Card className="mb-3">
            <AppText variant="caption">{t('auth', 'fullName')}</AppText>
            <AppText variant="heading">{user.fullName}</AppText>
            <AppText variant="caption" className="mt-3">
              {t('auth', 'phone')}
            </AppText>
            <AppText variant="body">{toLocalPhone(user.phone)}</AppText>
          </Card>
          <Button title={t('auth', 'logout')} variant="danger" onPress={() => void logout()} />
        </View>
      )}

      <View className="items-center pb-4">
        <AppText variant="caption">
          {t('customer', 'appVersion')}: {version}
        </AppText>
      </View>
    </Screen>
  );
}
