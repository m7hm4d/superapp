import { AppText, DirectionalIcon } from '@superapp/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';

/** رأس شاشة موحد: زر رجوع (سهم ينعكس تلقائياً في RTL) + عنوان */
export function ScreenHeader({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  const router = useRouter();
  return (
    <View className="flex-row items-center gap-2 bg-surface px-4 py-3">
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        className="min-h-touch min-w-touch items-center justify-center rounded-full"
        hitSlop={8}
      >
        <DirectionalIcon name="chevron-back" size={24} />
      </Pressable>
      <AppText variant="heading" className="flex-1">
        {title}
      </AppText>
      {trailing}
    </View>
  );
}
