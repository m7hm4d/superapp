import { TextInput, View, type TextInputProps } from 'react-native';
import { AppText } from './text';
import { cn } from './cn';

export interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  className?: string;
}

/** حقل إدخال صديق للوحة المفاتيح العربية — محاذاة النص لليمين افتراضياً */
export function Input({ label, error, className, textAlign = 'right', ...rest }: InputProps) {
  return (
    <View className="gap-1.5">
      {label ? (
        <AppText variant="caption" className="font-bold text-neutral-700">
          {label}
        </AppText>
      ) : null}
      <TextInput
        textAlign={textAlign}
        placeholderTextColor="#a3a3a3"
        className={cn(
          'min-h-touch rounded-card border bg-surface px-4 py-3 font-sans text-base text-neutral-900',
          error ? 'border-status-cancelled' : 'border-neutral-300',
          className,
        )}
        {...rest}
      />
      {error ? (
        <AppText variant="caption" className="text-status-cancelled">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}
