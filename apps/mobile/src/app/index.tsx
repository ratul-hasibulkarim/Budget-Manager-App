import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { netBalances, type ProjectSync } from '@bm/core';
import { Banner, Button, Card, Chip, Empty, Fab, Row, Screen, Txt } from '../components/ui';
import { SyncBanner } from '../components/SyncBanner';
import { useSettings } from '../lib/settings';
import { useWorkspace } from '../lib/workspace';
import { digits, money } from '../lib/format';

type Filter = 'active' | 'archived' | 'trashed';

export default function Home() {
  const { t, theme, settings } = useSettings();
  const ws = useWorkspace();
  const [filter, setFilter] = useState<Filter>('active');

  const visible = ws.projects
    .filter((p) => {
      const s = p.state;
      if (!s) return filter === 'active'; // waiting for approval / not yet downloaded
      return s.status === filter;
    })
    .sort((a, b) => (b.state?.lastActivityAt ?? Infinity) - (a.state?.lastActivityAt ?? Infinity));

  return (
    <Screen
      footer={filter === 'active' ? <Fab testID="new-project" label={t('newProject')} onPress={() => router.push('/new')} /> : null}
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable testID="open-settings" accessibilityLabel={t('settings')} onPress={() => router.push('/settings')} style={{ padding: 8 }}>
              <Txt size={20} color={theme.onHeader}>
                ⚙
              </Txt>
            </Pressable>
          ),
        }}
      />
      <SyncBanner />
      <Row wrap>
        <Chip testID="filter-active" label={t('active')} selected={filter === 'active'} onPress={() => setFilter('active')} />
        <Chip testID="filter-archived" label={t('archive')} selected={filter === 'archived'} onPress={() => setFilter('archived')} />
        <Chip testID="filter-trashed" label={t('trash')} selected={filter === 'trashed'} onPress={() => setFilter('trashed')} />
        <View style={{ flex: 1 }} />
        <Button small kind="ghost" testID="sync-now" label={ws.net === 'syncing' ? '…' : t('syncNow')} onPress={() => void ws.syncAll()} />
      </Row>
      {filter === 'active' ? <Button testID="join-project" kind="secondary" label={t('joinProject')} onPress={() => router.push('/join')} /> : null}
      {filter === 'trashed' ? <Banner text={t('trashInfo')} /> : null}
      {visible.length === 0 ? (
        <Empty text={t(filter === 'active' ? 'noProjects' : filter === 'archived' ? 'noArchived' : 'noTrash')} />
      ) : (
        visible.map((p) => <ProjectCard key={p.projectId} sync={p} lang={settings.lang} />)
      )}
    </Screen>
  );
}

function ProjectCard({ sync, lang }: { sync: ProjectSync; lang: 'en' | 'bn' }) {
  const { t, theme } = useSettings();
  const ws = useWorkspace();
  const s = sync.state;
  const access = sync.doc.access;
  if (!s || access !== 'ok') {
    const text = access === 'pending' || (!s && sync.doc.pending.some((o) => o.type === 'member.requestJoin'))
      ? t('waitingApproval')
      : access === 'no_access'
        ? t('noAccess')
        : access === 'purged'
          ? t('deletedForever')
          : t('syncPending', { count: sync.doc.pending.length });
    return (
      <Card testID={`project-${sync.projectId}`}>
        <Txt weight="semibold" size={17}>
          {s?.name ?? sync.doc.placeholderName ?? '…'}
        </Txt>
        <Txt muted>{text}</Txt>
        {access === 'no_access' || access === 'purged' ? <Button small kind="secondary" label={t('dismiss')} onPress={() => void ws.forget(sync.projectId)} /> : null}
      </Card>
    );
  }
  const net = netBalances(s)[ws.userId] ?? 0;
  const memberCount = Object.values(s.members).filter((m) => m.status === 'active').length;
  return (
    <Pressable testID={`project-${s.name}`} onPress={() => router.push(`/project/${sync.projectId}`)}>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt weight="semibold" size={17} style={{ flex: 1 }} numberOfLines={1}>
            {s.name}
          </Txt>
          <Txt size={12} muted>
            {s.type === 'group' ? `${t('group')} · ${digits(memberCount, lang)} ${t('members')}` : t('personal')}
          </Txt>
        </Row>
        {s.type === 'group' ? (
          <Txt color={net > 0 ? theme.positive : net < 0 ? theme.negative : theme.textMuted}>
            {net > 0 ? `${t('youAreOwed')} ${money(net, lang, s.currency)}` : net < 0 ? `${t('youOwe')} ${money(-net, lang, s.currency)}` : t('allSettled')}
          </Txt>
        ) : null}
        {sync.doc.pending.length ? (
          <Txt size={12} muted>
            ⏳ {t('savedOnPhone')}
          </Txt>
        ) : null}
      </Card>
    </Pressable>
  );
}
