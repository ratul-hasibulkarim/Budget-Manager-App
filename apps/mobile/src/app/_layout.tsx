import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { useFonts, HindSiliguri_400Regular, HindSiliguri_500Medium, HindSiliguri_600SemiBold, HindSiliguri_700Bold } from '@expo-google-fonts/hind-siliguri';
import { setRandomSource } from '@bm/core';
import { SettingsProvider, useSettings } from '../lib/settings';
import { WorkspaceProvider } from '../lib/workspace';
import { FONT } from '../lib/theme';

// Secure random ids on every platform.
setRandomSource((n) => Crypto.getRandomBytes(n));

function Navigator() {
  const { theme, t, ready } = useSettings();
  useEffect(() => {
    if (typeof document !== 'undefined') document.title = t('appName');
  }, [t]);
  if (!ready) return <Loading />;
  return (
    <WorkspaceProvider>
      <StatusBar style={theme.dark || theme.header !== '#FFFFFF' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.header },
          headerTintColor: theme.onHeader,
          headerTitleStyle: { fontFamily: FONT.semibold },
          contentStyle: { backgroundColor: theme.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: t('appName') }} />
        <Stack.Screen name="new" options={{ title: t('newProject') }} />
        <Stack.Screen name="join" options={{ title: t('joinProject') }} />
        <Stack.Screen name="settings" options={{ title: t('settings') }} />
        <Stack.Screen name="project/[id]/index" options={{ title: '' }} />
        <Stack.Screen name="project/[id]/expense" options={{ title: t('addExpense') }} />
        <Stack.Screen name="project/[id]/entry" options={{ title: t('history') }} />
        <Stack.Screen name="project/[id]/settle" options={{ title: t('settleUp') }} />
        <Stack.Screen name="project/[id]/settings" options={{ title: t('projectSettings') }} />
        <Stack.Screen name="project/[id]/profile" options={{ title: t('editProfile') }} />
      </Stack>
    </WorkspaceProvider>
  );
}

function Loading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ HindSiliguri_400Regular, HindSiliguri_500Medium, HindSiliguri_600SemiBold, HindSiliguri_700Bold });
  if (!fontsLoaded && !fontError) return <Loading />;
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <Navigator />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
