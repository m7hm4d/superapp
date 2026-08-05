import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { AppText, Button, MoneyText } from '@superapp/ui';
import { t } from '@superapp/i18n';
import { useAlertStore } from '../stores/alert';
import { useAuthStore } from '../stores/auth';

/**
 * تنبيه الطلب الجديد (M-02، §5 «حالات وليست صفحات»):
 * Overlay نابض + اهتزاز متكرر حتى الإقرار؛ لا يفتح التفاصيل تلقائياً.
 */
export function NewOrderOverlay() {
  const pending = useAlertStore((s) => s.pending);
  const dismiss = useAlertStore((s) => s.dismiss);
  const authed = useAuthStore((s) => s.status === 'authed');
  const router = useRouter();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pending) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    // اهتزاز تنبيهي متكرر ما دام التنبيه غير مُقرّ
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const interval = setInterval(() => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }, 2500);
    return () => {
      loop.stop();
      clearInterval(interval);
    };
  }, [pending, pulse]);

  if (!pending || !authed) return null;

  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 top-14 z-50 px-4">
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Pressable
          accessibilityRole="alert"
          onPress={() => {
            dismiss();
            router.navigate('/(tabs)');
          }}
          className="bg-brand-600 rounded-card p-4 shadow-lg gap-2"
        >
          <View className="flex-row items-center justify-between">
            <AppText variant="heading" className="text-white">
              {t('vendor', 'newOrder')}
            </AppText>
            <AppText variant="money" className="text-white">
              {pending.code}
            </AppText>
          </View>
          <View className="flex-row items-center justify-between">
            <AppText variant="body" className="text-brand-100">
              {t('vendor', 'itemsCount', { count: pending.itemsCount })}
            </AppText>
            <MoneyText amountIqd={pending.totalIqd} className="text-white" />
          </View>
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                title={t('vendor', 'view')}
                variant="secondary"
                onPress={() => {
                  dismiss();
                  router.navigate('/(tabs)');
                }}
              />
            </View>
            <View className="flex-1">
              <Button title={t('vendor', 'dismiss')} variant="ghost" onPress={dismiss} />
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}
