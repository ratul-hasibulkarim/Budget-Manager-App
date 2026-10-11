import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getLocales } from 'expo-localization';
import { newId } from '@bm/core';
import { THEMES, type Theme, type ThemeName } from './theme';
import { translate, type Lang, type TKey } from './i18n';

export interface Account {
  userId: string;
  /** Made on this phone; proves ownership of the id to the server. */
  secret: string;
  token?: string;
}

export interface Settings {
  theme: ThemeName;
  lang: Lang;
  displayName: string;
  serverUrl: string;
  account: Account | null;
}

const KEY = 'bm.settings.v1';
export const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:8787';

function deviceLang(): Lang {
  try {
    return getLocales()[0]?.languageCode === 'bn' ? 'bn' : 'en';
  } catch {
    return 'en';
  }
}

const defaults: Settings = { theme: 'light', lang: deviceLang(), displayName: '', serverUrl: DEFAULT_SERVER, account: null };

interface Ctx {
  settings: Settings;
  ready: boolean;
  update(patch: Partial<Settings>): void;
  theme: Theme;
  t(key: TKey, vars?: Record<string, string | number>): string;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      let loaded: Settings = defaults;
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) loaded = { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
      } catch {
        // Corrupt settings: start from defaults rather than failing to open.
      }
      if (!loaded.account) {
        // Offline-first account: made on the phone, registered with the server when online.
        loaded = { ...loaded, account: { userId: `u${newId()}`, secret: `${newId()}${newId()}` } };
        await AsyncStorage.setItem(KEY, JSON.stringify(loaded));
      }
      setSettings(loaded);
      setReady(true);
    })();
  }, []);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void AsyncStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      settings,
      ready,
      update,
      theme: THEMES[settings.theme] ?? THEMES.light,
      t: (key, vars) => translate(settings.lang, key, vars),
    }),
    [settings, ready, update],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('SettingsProvider missing');
  return ctx;
}
