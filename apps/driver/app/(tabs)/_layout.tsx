import { Ionicons } from '@expo/vector-icons';
import { t } from '@superapp/i18n';
import { Tabs } from 'expo-router';
import React from 'react';

/** التنقل السفلي: العمل — السجل — النقد — الحساب (الملف §6) */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#de5a16',
        tabBarInactiveTintColor: '#78716c',
        tabBarLabelStyle: { fontFamily: 'IBMPlexSansArabic', fontSize: 12 },
        tabBarStyle: { minHeight: 56 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('driver', 'tabWork'),
          tabBarIcon: ({ color, size }) => <Ionicons name="bicycle" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('driver', 'tabHistory'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cash"
        options={{
          title: t('driver', 'tabCash'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cash-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('driver', 'tabAccount'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
