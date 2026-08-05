import { Pressable, View, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@superapp/i18n';
import { AppText } from './text';
import { cn } from './cn';

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

const VALUE_STYLE: TextStyle = { fontVariant: ['tabular-nums'] };

export function Stepper({ value, onChange, min = 0, max = 99 }: StepperProps) {
  const canDecrease = value > min;
  const canIncrease = value < max;
  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common', 'decrease')}
        accessibilityState={{ disabled: !canDecrease }}
        disabled={!canDecrease}
        onPress={() => onChange(Math.max(min, value - 1))}
        className={cn(
          'min-h-touch min-w-touch items-center justify-center rounded-full bg-brand-50 active:bg-brand-100',
          !canDecrease && 'opacity-40',
        )}
      >
        <Ionicons name="remove" size={22} color="#de5a16" />
      </Pressable>
      <AppText variant="heading" className="min-w-[36px] text-center" style={VALUE_STYLE}>
        {value}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common', 'increase')}
        accessibilityState={{ disabled: !canIncrease }}
        disabled={!canIncrease}
        onPress={() => onChange(Math.min(max, value + 1))}
        className={cn(
          'min-h-touch min-w-touch items-center justify-center rounded-full bg-brand-50 active:bg-brand-100',
          !canIncrease && 'opacity-40',
        )}
      >
        <Ionicons name="add" size={22} color="#de5a16" />
      </Pressable>
    </View>
  );
}
