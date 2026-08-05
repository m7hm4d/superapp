import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '@superapp/i18n';
import { AppText } from './text';

export interface OfflineBarProps {
  visible: boolean;
}

/** شريط انقطاع الاتصال — يظهر أعلى الشاشة عند انفصال السوكِت (الملف §11) */
export function OfflineBar({ visible }: OfflineBarProps) {
  if (!visible) return null;
  return (
    <View
      accessibilityLiveRegion="polite"
      className="flex-row items-center justify-center gap-2 bg-surface-dark px-4 py-2"
    >
      <Ionicons name="cloud-offline-outline" size={16} color="#ffffff" />
      <AppText variant="caption" className="text-white">
        {t('common', 'offline')}
      </AppText>
    </View>
  );
}
