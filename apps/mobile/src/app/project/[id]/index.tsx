import { useState } from 'react';
import { Pressable } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Banner, Empty, Screen, Tabs, Txt } from '../../../components/ui';
import { useSettings } from '../../../lib/settings';
import { useProject } from '../../../lib/workspace';
import { Dashboard } from '../../../screens/Dashboard';
import { ExpenseList } from '../../../screens/ExpenseList';
import { Members } from '../../../screens/Members';
import { SyncBanner } from '../../../components/SyncBanner';

type Tab = 'dashboard' | 'expenses' | 'members' | 'gallery';

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, theme } = useSettings();
  const { sync, state } = useProject(id);
  const [tab, setTab] = useState<Tab>('dashboard');

  if (!sync || !state) {
    return (
      <Screen>
        <Stack.Screen options={{ title: sync?.doc.placeholderName ?? '' }} />
        <Empty text={sync?.doc.access === 'pending' ? t('waitingApproval') : sync?.doc.access === 'purged' ? t('deletedForever') : '…'} />
      </Screen>
    );
  }

  const tabs: { key: Tab; label: string }[] =
    state.type === 'group'
      ? [
          { key: 'dashboard', label: t('dashboard') },
          { key: 'expenses', label: t('expenses') },
          { key: 'members', label: t('members') },
          { key: 'gallery', label: t('gallery') },
        ]
      : [
          { key: 'dashboard', label: t('dashboard') },
          { key: 'expenses', label: t('expenses') },
        ];

  return (
    <>
      <Stack.Screen
        options={{
          title: state.name,
          headerRight: () => (
            <Pressable testID="project-settings" accessibilityLabel={t('projectSettings')} onPress={() => router.push(`/project/${id}/settings`)} style={{ padding: 8 }}>
              <Txt size={20} color={theme.onHeader}>
                ⚙
              </Txt>
            </Pressable>
          ),
        }}
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'dashboard' ? <Dashboard projectId={id} /> : null}
      {tab === 'expenses' ? <ExpenseList projectId={id} /> : null}
      {tab === 'members' ? <Members projectId={id} /> : null}
      {tab === 'gallery' ? (
        <Screen>
          <SyncBanner />
          <Banner text={t('galleryComing')} />
        </Screen>
      ) : null}
    </>
  );
}
