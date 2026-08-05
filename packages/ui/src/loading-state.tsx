import { ActivityIndicator, View } from 'react-native';
import { t } from '@superapp/i18n';
import { AppText } from './text';

export function LoadingState() {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-6">
      <ActivityIndicator size="large" color="#ed7320" />
      <AppText variant="caption">{t('common', 'loading')}</AppText>
    </View>
  );
}
