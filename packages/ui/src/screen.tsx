import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { cn } from './cn';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
}

/** حاوية الشاشة الأساسية — خلفية موحدة وحشوة اختيارية وتمرير اختياري */
export function Screen({ children, scroll = false, padded = true }: ScreenProps) {
  if (scroll) {
    return (
      <ScrollView
        className="flex-1 bg-surface-muted"
        contentContainerClassName={cn(padded && 'p-4 pb-8')}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return <View className={cn('flex-1 bg-surface-muted', padded && 'p-4')}>{children}</View>;
}
