import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@superapp/i18n';
import { AppText } from './text';
import { Button } from './button';

export interface ErrorStateProps {
  message?: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-6">
      <Ionicons name="alert-circle-outline" size={48} color="#b91c1c" />
      <AppText variant="heading" className="text-center">
        {message ?? t('common', 'error')}
      </AppText>
      <View className="mt-2">
        <Button title={t('common', 'retry')} onPress={onRetry} variant="secondary" />
      </View>
    </View>
  );
}
