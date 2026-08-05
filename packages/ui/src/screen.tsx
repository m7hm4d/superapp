import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cn } from './cn';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  /** مساحة الأمان العلوية (الساعة/النوتش) — عطّلها فقط لشاشات الخريطة ملء الشاشة */
  safeTop?: boolean;
}

/** حاوية الشاشة الأساسية — خلفية موحدة + مساحة أمان علوية افتراضية (الملف §11) */
export function Screen({ children, scroll = false, padded = true, safeTop = true }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const topPad = safeTop ? { paddingTop: insets.top + 4 } : undefined;

  if (scroll) {
    return (
      <ScrollView
        className="flex-1 bg-surface-muted"
        style={topPad}
        contentContainerClassName={cn(padded && 'p-4 pb-8')}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return (
    <View style={topPad} className={cn('flex-1 bg-surface-muted', padded && 'p-4')}>
      {children}
    </View>
  );
}
