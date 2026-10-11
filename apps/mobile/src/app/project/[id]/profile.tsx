import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import type { MemberProfile } from '@bm/core';
import { Banner, Button, Card, Field, Screen, Txt } from '../../../components/ui';
import { useSettings } from '../../../lib/settings';
import { useProject, useWorkspace } from '../../../lib/workspace';
import { errorText } from '../../../lib/format';

/** A member edits their own details. Every field is optional. */
export default function Profile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useSettings();
  const ws = useWorkspace();
  const { state } = useProject(id);
  const current = state?.members[ws.userId]?.profile ?? {};
  const [p, setP] = useState<MemberProfile>(current);
  const [error, setError] = useState<string | null>(null);
  if (!state) return null;
  const field = (key: keyof MemberProfile, label: string, extra: object = {}) => (
    <Field testID={`profile-${key}`} label={`${label} ${t('optional')}`} value={p[key] ?? ''} onChangeText={(v) => setP((x) => ({ ...x, [key]: v }))} {...extra} />
  );

  async function save() {
    try {
      await ws.submit(id, 'member.updateProfile', { profile: p });
      router.back();
    } catch (e) {
      setError(errorText(e, t));
    }
  }

  return (
    <Screen>
      <Card>
        {field('name', t('yourName'))}
        {field('whatsapp', t('whatsapp'), { keyboardType: 'phone-pad' })}
        {field('bkash', t('bkash'), { keyboardType: 'phone-pad' })}
        {field('bankAccount', t('bankAccount'))}
        {field('address', t('address'), { multiline: true })}
        {field('nid', t('nid'), { keyboardType: 'number-pad' })}
        <Txt size={12} muted>
          {t('onlyAdminsSeeNid')}
        </Txt>
      </Card>
      {error ? <Banner kind="error" text={error} /> : null}
      <Button testID="save-profile" label={t('save')} onPress={() => void save()} disabled={state.status !== 'active'} />
    </Screen>
  );
}
