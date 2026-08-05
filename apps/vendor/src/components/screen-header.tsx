import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText, DirectionalIcon } from '@superapp/ui';
import { t } from '@superapp/i18n';

/** ترويسة بسيطة RTL مع زر رجوع — بدل الترويسة الأصلية للنظام */
export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const router = useRouter();
  return (
    <View className="flex-row items-center gap-2 px-4 py-3 bg-surface border-b border-surface-muted">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common', 'back')}
        onPress={onBack ?? (() => router.back())}
        className="min-h-touch min-w-touch items-center justify-center rounded-card"
      >
        <DirectionalIcon name="chevron-forward" size={24} color="#171412" />
      </Pressable>
      <AppText variant="heading" className="flex-1">
        {title}
      </AppText>
    </View>
  );
}
