import { Switch, View } from 'react-native';
import { AppText } from './text';
import { cn } from './cn';

export interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label?: string;
}

export function Toggle({ value, onValueChange, label }: ToggleProps) {
  return (
    <View className={cn('min-h-touch flex-row items-center gap-3', label ? 'justify-between' : 'justify-start')}>
      {label ? <AppText variant="body">{label}</AppText> : null}
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#d4d4d4', true: '#ed7320' }}
        thumbColor="#ffffff"
        ios_backgroundColor="#d4d4d4"
      />
    </View>
  );
}
