import type { ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';
import { cn } from './cn';

export type AppTextVariant = 'title' | 'heading' | 'body' | 'caption' | 'money';

export interface AppTextProps extends TextProps {
  variant?: AppTextVariant;
  className?: string;
  children?: ReactNode;
}

const variantClasses: Record<AppTextVariant, string> = {
  title: 'text-2xl font-bold text-neutral-900',
  heading: 'text-lg font-bold text-neutral-900',
  body: 'text-base text-neutral-800',
  caption: 'text-sm text-neutral-500',
  money: 'text-base font-bold text-neutral-900',
};

/** أرقام لاتينية ثابتة العرض للمبالغ */
const MONEY_STYLE: TextStyle = { fontVariant: ['tabular-nums'] };

export function AppText({ variant = 'body', className, style, children, ...rest }: AppTextProps) {
  return (
    <Text
      className={cn('font-sans', variantClasses[variant], className)}
      style={variant === 'money' ? [MONEY_STYLE, style] : style}
      {...rest}
    >
      {children}
    </Text>
  );
}
