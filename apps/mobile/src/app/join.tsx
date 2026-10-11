import { useState } from 'react';
import { router } from 'expo-router';
import { Banner, Button, Card, Field, Screen, Txt } from '../components/ui';
import { useSettings } from '../lib/settings';
import { useWorkspace } from '../lib/workspace';
import { digits } from '../lib/format';

export default function Join() {
  const { t, settings, update } = useSettings();
  const ws = useWorkspace();
  const [code, setCode] = useState('');
  const [name, setName] = useState(settings.displayName);
  const [found, setFound] = useState<{ projectId: string; name: string; memberCount: number } | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    setBusy(true);
    setMessage(null);
    setFound(null);
    try {
      const res = await ws.lookupInvite(code);
      if (res) setFound(res);
      else setMessage({ kind: 'error', text: t('notFound') });
    } catch {
      setMessage({ kind: 'error', text: t('needsInternet') });
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!found) return;
    setBusy(true);
    try {
      if (name.trim() && name.trim() !== settings.displayName) update({ displayName: name.trim() });
      await ws.requestJoin(found.projectId, found.name, code, name.trim());
      setMessage({ kind: 'info', text: t('joinSent') });
      setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/')), 1200);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field
        testID="invite-code"
        label={t('inviteCode')}
        hint={t('enterCode')}
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
      />
      <Button testID="find-invite" label={t('find')} onPress={find} busy={busy && !found} disabled={code.trim().length < 6} />
      {found ? (
        <Card testID="invite-found">
          <Txt weight="semibold" size={17}>
            {found.name}
          </Txt>
          <Txt muted>
            {digits(found.memberCount, settings.lang)} {t('members')}
          </Txt>
          <Field testID="join-name" label={t('yourName')} value={name} onChangeText={setName} />
          <Button testID="ask-to-join" label={t('askToJoin')} onPress={join} busy={busy} />
        </Card>
      ) : null}
      {message ? <Banner testID="join-message" kind={message.kind} text={message.text} /> : null}
    </Screen>
  );
}
