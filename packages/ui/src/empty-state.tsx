import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from './text';
import { Button } from './button';

export interface EmptyStateProps {
  title: string;
  body?: string;
  actionTitle?: string;
  onAction?: () => void;
}

export function EmptyState({ title, body, actionTitle, onAction }: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-6">
      <Ionicons name="file-tray-outline" size={48} color="#d4d4d4" />
      <AppText variant="heading" className="text-center">
        {title}
      </AppText>
      {body ? (
        <AppText variant="caption" className="text-center">
          {body}
        </AppText>
      ) : null}
      {actionTitle && onAction ? (
        <View className="mt-2">
          <Button title={actionTitle} onPress={onAction} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}
