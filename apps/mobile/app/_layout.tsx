import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo } from 'react';
import { backendFromEnv } from '../src/backend/supabase';
import { AppProvider, useApp } from '../src/state/AppState';
import { ThemeProvider } from '../src/state/theme';
import { useFonts } from 'expo-font';
import { Barlow_400Regular, Barlow_600SemiBold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed';
import { THEMES, colors } from '../src/ui/kit';

function Gate() {
  const { profile, signedIn, loading } = useApp();
  const segments = useSegments();
  const onOnboarding = segments[0] === 'onboarding';
  const onLogin = segments[0] === 'login';
  if (loading) return null; // screens assume a profile; do not mount them before it is known
  if (!signedIn && !onLogin) return <Redirect href="/login" />;
  if (signedIn && onLogin) return <Redirect href="/" />;
  if (signedIn && !profile && !onOnboarding) return <Redirect href="/onboarding" />;
  if (profile && onOnboarding) return <Redirect href="/" />;
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ title: 'Welcome', headerShown: false }} />
      <Stack.Screen name="game/[id]" options={{ title: 'Game' }} />
      <Stack.Screen name="report" options={{ title: 'Report', presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const backend = useMemo(() => backendFromEnv(), []);
  // A font that fails to load must never block the app: we fall back to the system font.
  const [loaded, fontError] = useFonts({ Barlow_400Regular, Barlow_600SemiBold, BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold });
  if (!loaded && !fontError) return null;
  return (
    <ThemeProvider>
      {(theme) => (
        <AppProvider backend={backend}>
          <StatusBar style={THEMES[theme].tokens.light ? 'dark' : 'light'} />
          <React.Fragment key={theme}>
            <Gate />
          </React.Fragment>
        </AppProvider>
      )}
    </ThemeProvider>
  );
}
