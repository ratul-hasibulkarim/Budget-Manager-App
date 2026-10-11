import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { BackupError } from '@bm/core';
import { Banner, Button, Card, Chip, Field, Row, Screen, Section, Txt } from '../components/ui';
import { useSettings } from '../lib/settings';
import { useWorkspace } from '../lib/workspace';
import { THEMES, THEME_ORDER, type ThemeName } from '../lib/theme';
import { pickTextFile, saveTextFile } from '../lib/files';
import { isoDate } from '../lib/format';
import type { TKey } from '../lib/i18n';

const THEME_LABEL: Record<ThemeName, TKey> = {
  light: 'themeLight',
  black: 'themeBlack',
  maroon: 'themeMaroon',
  blue: 'themeBlue',
  green: 'themeGreen',
};

export default function SettingsScreen() {
  const { t, settings, update, theme } = useSettings();
  const ws = useWorkspace();
  const [server, setServer] = useState(settings.serverUrl);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  async function exportBackup() {
    const text = await ws.exportBackup();
    await saveTextFile(`budget-manager-backup-${isoDate()}.json`, text);
  }

  async function importBackup() {
    const text = await pickTextFile();
    if (!text) return;
    try {
      const count = await ws.importBackup(text);
      setMessage({ kind: 'info', text: t('backupDone', { count }) });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof BackupError ? e.message : t('err_generic') });
    }
  }

  return (
    <Screen>
      <Section title={t('appearance')}>
        <Card>
          <Txt weight="medium">{t('theme')}</Txt>
          <Row wrap>
            {THEME_ORDER.map((name) => {
              const th = THEMES[name];
              const on = settings.theme === name;
              return (
                <Pressable
                  key={name}
                  testID={`theme-${name}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => update({ theme: name })}
                  style={{ alignItems: 'center', gap: 4, padding: 6, borderRadius: 12, borderWidth: 2, borderColor: on ? theme.primary : 'transparent' }}
                >
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: th.bg, borderWidth: 1, borderColor: th.border, overflow: 'hidden' }}>
                    <View style={{ height: 22, backgroundColor: th.header }} />
                    <View style={{ position: 'absolute', right: 6, bottom: 6, width: 14, height: 14, borderRadius: 7, backgroundColor: th.primary }} />
                  </View>
                  <Txt size={12}>{t(THEME_LABEL[name])}</Txt>
                </Pressable>
              );
            })}
          </Row>
          <Txt weight="medium">{t('language')}</Txt>
          <Row>
            <Chip testID="lang-bn" label="বাংলা" selected={settings.lang === 'bn'} onPress={() => update({ lang: 'bn' })} />
            <Chip testID="lang-en" label="English" selected={settings.lang === 'en'} onPress={() => update({ lang: 'en' })} />
          </Row>
        </Card>
      </Section>

      <Section title={t('account')}>
        <Card>
          <Field testID="display-name" label={t('displayName')} value={settings.displayName} onChangeText={(v) => update({ displayName: v })} />
          <Txt size={12} muted>
            {t('userId')}: {settings.account?.userId}
          </Txt>
        </Card>
      </Section>

      <Section title={t('backup')}>
        <Card>
          <Txt muted size={13}>
            {t('backupHint')}
          </Txt>
          <Button testID="export-backup" kind="secondary" label={t('exportBackup')} onPress={() => void exportBackup()} />
          <Button testID="import-backup" kind="secondary" label={t('importBackup')} onPress={() => void importBackup()} />
          {message ? <Banner testID="backup-message" kind={message.kind} text={message.text} /> : null}
          <Txt weight="medium">{t('driveBackup')}</Txt>
          <Txt muted size={13}>
            {t('driveComing')}
          </Txt>
        </Card>
      </Section>

      <Section title={t('server')}>
        <Card>
          <Field testID="server-url" label={t('serverUrl')} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} />
          <Button
            small
            kind="secondary"
            label={t('save')}
            disabled={server.trim() === settings.serverUrl || !/^https?:\/\//.test(server.trim())}
            onPress={() => update({ serverUrl: server.trim().replace(/\/$/, ''), account: settings.account ? { ...settings.account, token: undefined } : null })}
          />
        </Card>
      </Section>
    </Screen>
  );
}
