import type { ComponentProps } from 'react';
import { I18nManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface DirectionalIconProps {
  name: ComponentProps<typeof Ionicons>['name'];
  size?: number;
  color?: string;
}

/** الأيقونات الاتجاهية (أسهم/شيفرون) تنعكس أفقياً تحت RTL */
function isDirectional(name: string): boolean {
  return name.startsWith('chevron-') || name.startsWith('arrow-') || name.startsWith('return-');
}

export function DirectionalIcon({ name, size = 20, color = '#171412' }: DirectionalIconProps) {
  const flip = I18nManager.isRTL && isDirectional(name);
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      style={flip ? { transform: [{ scaleX: -1 }] } : undefined}
    />
  );
}
