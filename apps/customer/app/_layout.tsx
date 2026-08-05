import '../global.css';

import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { OfflineBar } from '@superapp/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { I18nManager, View } from 'react-native';
import { SocketProvider, useSocket } from '../src/lib/socket';
import { useAuthStore } from '../src/stores/auth';

// عربي أولاً: RTL إجباري قبل أول تصيير
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnReconnect: true,
      },
    },
  });
}

function AppShell() {
  const { connected } = useSocket();
  return (
    <View className="flex-1 bg-surface-muted">
      <OfflineBar visible={!connected} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="store/[id]" />
        <Stack.Screen name="cart" />
        <Stack.Screen name="checkout" />
        <Stack.Screen name="order/[id]" />
        <Stack.Screen name="auth/login" options={{ presentation: 'modal' }} />
        <Stack.Screen name="auth/register" options={{ presentation: 'modal' }} />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(makeQueryClient);
  const hydrate = useAuthStore((s) => s.hydrate);

  const [fontsLoaded] = useFonts({
    IBMPlexSansArabic: IBMPlexSansArabic_400Regular,
    'IBMPlexSansArabic-Medium': IBMPlexSansArabic_500Medium,
    'IBMPlexSansArabic-Bold': IBMPlexSansArabic_700Bold,
  });

  // بوابة الدخول: ترطيب الجلسة دون فرض تسجيل — العميل يتصفح كضيف (§3)
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <SocketProvider>
        <StatusBar style="dark" />
        <AppShell />
      </SocketProvider>
    </QueryClientProvider>
  );
}
