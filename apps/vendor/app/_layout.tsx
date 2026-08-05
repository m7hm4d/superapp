import '../global.css';

import React, { useEffect, useRef } from 'react';
import { I18nManager, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoadingState, OfflineBar } from '@superapp/ui';
import { SocketProvider, useSocketStatus } from '../src/lib/socket';
import { useAuthStore } from '../src/stores/auth';
import { registerPushToken } from '../src/lib/push';
import { useApprovalStore } from '../src/stores/approval';
import { NewOrderOverlay } from '../src/components/new-order-overlay';

// عربي أولاً: فرض RTL قبل أي رسم
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** بوابة التوجيه: ضيف → دخول؛ محجوب → M-01 التفعيل؛ مصادق → التبويبات */
function AuthGate({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);

  React.useEffect(() => {
    if (status === 'authed') void registerPushToken();
  }, [status]);
  const hydrate = useAuthStore((s) => s.hydrate);
  const blocked = useApprovalStore((s) => s.blocked);
  const segments = useSegments();
  const router = useRouter();
  const hydrated = useRef(false);

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      void hydrate();
    }
  }, [hydrate]);

  useEffect(() => {
    if (status === 'loading') return;
    const first = segments[0] as string | undefined;
    const inAuth = first === 'auth';
    const inActivation = first === 'activation';

    if (status === 'guest') {
      if (!inAuth) router.replace('/auth/login');
      return;
    }
    if (blocked) {
      if (!inActivation) router.replace('/activation');
      return;
    }
    if (inAuth || inActivation) router.replace('/(tabs)');
  }, [status, blocked, segments, router]);

  if (status === 'loading') return <LoadingState />;
  return <>{children}</>;
}

/** شريط عدم الاتصال (§11): يظهر عند انقطاع الـsocket أثناء الجلسة */
function ConnectionBar() {
  const { connected } = useSocketStatus();
  const authed = useAuthStore((s) => s.status === 'authed');
  return <OfflineBar visible={authed && !connected} />;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    IBMPlexSansArabic: IBMPlexSansArabic_400Regular,
    'IBMPlexSansArabic-Medium': IBMPlexSansArabic_500Medium,
    'IBMPlexSansArabic-Bold': IBMPlexSansArabic_700Bold,
  });

  if (!fontsLoaded) return <LoadingState />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SocketProvider>
          <View className="flex-1 bg-surface-muted">
            <StatusBar style="dark" />
            <ConnectionBar />
            <AuthGate>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="auth/login" />
                <Stack.Screen name="auth/register" />
                <Stack.Screen name="activation" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="order/[id]" />
                <Stack.Screen name="product/new" />
                <Stack.Screen name="product/[id]" />
                <Stack.Screen name="settlement-confirm" options={{ presentation: 'modal' }} />
              </Stack>
            </AuthGate>
            <NewOrderOverlay />
          </View>
        </SocketProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
