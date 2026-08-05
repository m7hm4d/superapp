import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { cn } from './cn';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  className?: string;
}

export function Card({ children, onPress, className }: CardProps) {
  const base = cn('rounded-card border border-neutral-100 bg-surface p-4', className);
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} className={cn(base, 'active:bg-neutral-50')}>
        {children}
      </Pressable>
    );
  }
  return <View className={base}>{children}</View>;
}
