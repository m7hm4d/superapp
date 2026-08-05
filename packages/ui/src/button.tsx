import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { AppText } from './text';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}

const containerClasses: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 active:bg-brand-600',
  secondary: 'border border-brand-500 bg-surface active:bg-brand-50',
  danger: 'bg-status-cancelled active:opacity-90',
  ghost: 'bg-transparent active:bg-brand-50',
};

const textClasses: Record<ButtonVariant, string> = {
  primary: 'text-white',
  secondary: 'text-brand-600',
  danger: 'text-white',
  ghost: 'text-brand-600',
};

/** لون المؤشر مأخوذ من رموز التصميم (brand-600 = #de5a16) */
const spinnerColor: Record<ButtonVariant, string> = {
  primary: '#ffffff',
  secondary: '#de5a16',
  danger: '#ffffff',
  ghost: '#de5a16',
};

export function Button({ title, onPress, variant = 'primary', loading = false, disabled = false, icon }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={title}
      onPress={onPress}
      disabled={isDisabled}
      className={cn(
        'min-h-touch min-w-touch flex-row items-center justify-center gap-2 rounded-card px-5 py-3',
        containerClasses[variant],
        isDisabled && 'opacity-50',
      )}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColor[variant]} />
      ) : (
        <>
          {icon ? <View>{icon}</View> : null}
          <AppText variant="body" className={cn('font-bold', textClasses[variant])}>
            {title}
          </AppText>
        </>
      )}
    </Pressable>
  );
}
