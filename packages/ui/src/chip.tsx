import { Pressable } from 'react-native';
import { AppText } from './text';
import { cn } from './cn';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}

export function Chip({ label, selected = false, onPress }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      disabled={!onPress}
      className={cn(
        'min-h-touch flex-row items-center justify-center rounded-full border px-4 py-2',
        selected ? 'border-brand-500 bg-brand-500' : 'border-neutral-300 bg-surface active:bg-neutral-50',
      )}
    >
      <AppText variant="body" className={cn('text-sm', selected ? 'font-bold text-white' : 'text-neutral-700')}>
        {label}
      </AppText>
    </Pressable>
  );
}
