import { Ionicons } from '@expo/vector-icons';
import { t } from '@superapp/i18n';
import { Tabs } from 'expo-router';
import React from 'react';

/** التنقل السفلي: استكشف — طلباتي — حسابي (§4) */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#ed7320',
        tabBarInactiveTintColor: '#78716c',
        tabBarLabelStyle: { fontFamily: 'IBMPlexSansArabic', fontSize: 12 },
        tabBarStyle: { minHeight: 56 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('customer', 'tabExplore'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'map' : 'map-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('customer', 'tabOrders'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('customer', 'tabAccount'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
