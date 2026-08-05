import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { client as api } from './api';

/**
 * تسجيل توكن Expo Push بعد الدخول — النطاق الضيق (طلب جديد فقط).
 * بلا EAS projectId (تطوير محلي) يتخطى بصمت؛ الـ socket + الصوت يغطيان.
 */
export async function registerPushToken(): Promise<void> {
  try {
    if (!Device.isDevice && Platform.OS === 'ios') return; // المحاكي لا يدعم push
    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;

    const perms = await Notifications.requestPermissionsAsync();
    if (!perms.granted) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api.post('me/push-token', {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  } catch {
    // الـ push تحسين اختياري — لا يكسر الدخول أبداً
  }
}
