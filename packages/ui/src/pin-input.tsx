import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';
import { cn } from './cn';

export interface PinInputProps {
  length?: number;
  onFilled: (pin: string) => void;
}

/** ترتيب الخانات يسار→يمين دائماً حتى تحت RTL — الرموز أرقام لاتينية */
const LTR_ROW: ViewStyle = { direction: 'ltr' };

const HIDDEN_INPUT: TextStyle = { position: 'absolute', opacity: 0, height: 1, width: 1 };

export function PinInput({ length = 4, onFilled }: PinInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<TextInput>(null);

  const handleChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '').slice(0, length);
    setValue(digits);
    if (digits.length === length) {
      onFilled(digits);
    }
  };

  return (
    <Pressable
      accessibilityRole="none"
      onPress={() => inputRef.current?.focus()}
      style={LTR_ROW}
      className="flex-row items-center justify-center gap-3"
    >
      {Array.from({ length }, (_, i) => {
        const isActive = i === Math.min(value.length, length - 1) && value.length < length;
        return (
          <View
            key={i}
            className={cn(
              'h-14 w-12 items-center justify-center rounded-card border-2 bg-surface',
              isActive ? 'border-brand-500' : 'border-neutral-300',
            )}
          >
            <Text
              className="font-sans text-2xl font-bold text-neutral-900"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {value[i] ?? ''}
            </Text>
          </View>
        );
      })}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus
        caretHidden
        style={HIDDEN_INPUT}
      />
    </Pressable>
  );
}
