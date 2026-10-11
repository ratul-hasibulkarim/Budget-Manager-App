import { Banner } from './ui';
import { useSettings } from '../lib/settings';
import { useWorkspace } from '../lib/workspace';

export function SyncBanner() {
  const { t } = useSettings();
  const ws = useWorkspace();
  const pending = ws.projects.reduce((a, p) => a + p.doc.pending.length, 0);
  if (ws.net === 'offline') return <Banner testID="sync-banner" kind="warn" text={pending ? `${t('syncOffline')} · ${t('syncPending', { count: pending })}` : t('syncOffline')} />;
  if (pending) return <Banner testID="sync-banner" text={t('syncPending', { count: pending })} />;
  return null;
}
