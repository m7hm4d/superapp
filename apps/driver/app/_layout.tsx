import '../global.css';

import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { ApprovalStatus } from '@superapp/shared';
import { LoadingState, OfflineBar } from '@superapp/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { I18nManager } from 'react-native';
import { SocketProvider, useSocket } from '../src/lib/socket';
import { useAuthStore } from '../src/stores/auth';
import { registerPushToken } from '../src/lib/push';

I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000 },
  },
});

/** حارس التوجيه: دخول إلزامي، وقيد المراجعة/الموقوف يحال إلى شاشة التفعيل (D-01) */
function AuthGate() {
  const status = useAuthStore((s) => s.status);

  React.useEffect(() => {
    if (status === 'authed') void registerPushToken();
  }, [status]);
  const user = useAuthStore((s) => s.user);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const seg = segments[0] as string | undefined;
    const inAuthScreens = seg === 'login' || seg === 'register';

    if (status === 'guest') {
      if (!inAuthScreens) router.replace('/login');
      return;
    }

    const approved = user?.approvalStatus === ApprovalStatus.APPROVED;
    if (!approved) {
      if (seg !== 'activation') router.replace('/activation');
      return;
    }
    if (inAuthScreens || seg === 'activation') router.replace('/');
  }, [status, user, segments, router]);

  return null;
}

function Shell() {
  const { connected } = useSocket();
  const status = useAuthStore((s) => s.status);

  return (
    <>
      <OfflineBar visible={status === 'authed' && !connected} />
      <AuthGate />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="activation" />
        <Stack.Screen name="batch/[id]" />
        <Stack.Screen name="active" options={{ gestureEnabled: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    IBMPlexSansArabic: IBMPlexSansArabic_400Regular,
    'IBMPlexSansArabic-Medium': IBMPlexSansArabic_500Medium,
    'IBMPlexSansArabic-Bold': IBMPlexSansArabic_700Bold,
  });
  const hydrate = useAuthStore((s) => s.hydrate);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <SocketProvider>
        <StatusBar style="dark" />
        {status === 'loading' ? <LoadingState /> : <Shell />}
      </SocketProvider>
    </QueryClientProvider>
  );
}
