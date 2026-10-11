import { useState } from 'react';
import { router } from 'expo-router';
import { Banner, Button, Card, Chip, Field, Row, Screen, Txt } from '../components/ui';
import { useSettings } from '../lib/settings';
import { useWorkspace } from '../lib/workspace';
import { CURRENCIES, errorText, parseAmount } from '../lib/format';

export default function NewProject() {
  const { t, settings, update } = useSettings();
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [type, setType] = useState<'group' | 'personal'>('group');
  const [currency, setCurrency] = useState('BDT');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [myName, setMyName] = useState(settings.displayName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const budgetValue = budget.trim() ? parseAmount(budget) : null;
  const budgetInvalid = budget.trim() !== '' && budgetValue === null;

  async function create() {
    if (!name.trim()) return setError(t('err_name'));
    if (budgetInvalid) return;
    setBusy(true);
    try {
      if (myName.trim() && myName.trim() !== settings.displayName) update({ displayName: myName.trim() });
      const id = await ws.createProject({
        type,
        name: name.trim(),
        currency,
        description: description.trim() || undefined,
        budgetTotal: budgetValue,
        creatorName: myName.trim() || undefined,
      });
      router.replace(`/project/${id}`);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Field testID="project-name" label={t('projectName')} placeholder={t('projectNameHint')} value={name} onChangeText={(v) => (setName(v), setError(null))} error={error} autoFocus />
      <Card>
        <Txt weight="medium">{t('projectType')}</Txt>
        <Row wrap>
          <Chip testID="type-group" label={t('group')} selected={type === 'group'} onPress={() => setType('group')} />
          <Chip testID="type-personal" label={t('personal')} selected={type === 'personal'} onPress={() => setType('personal')} />
        </Row>
        <Txt muted size={13}>
          {type === 'group' ? t('groupDesc') : t('personalDesc')}
        </Txt>
      </Card>
      <Field testID="my-name" label={`${t('yourName')} ${t('optional')}`} value={myName} onChangeText={setMyName} />
      <Field testID="project-description" label={`${t('description')} ${t('optional')}`} value={description} onChangeText={setDescription} multiline />
      <Field
        testID="project-budget"
        label={`${t('budget')} ${t('optional')}`}
        value={budget}
        onChangeText={setBudget}
        keyboardType="decimal-pad"
        error={budgetInvalid ? t('err_calc') : null}
      />
      <Txt size={13} muted weight="medium">
        {t('currency')}
      </Txt>
      <Row wrap>
        {CURRENCIES.map((c) => (
          <Chip key={c} label={c} selected={c === currency} onPress={() => setCurrency(c)} />
        ))}
      </Row>
      {type === 'group' ? <Banner text={t('autoArchiveInfo')} /> : null}
      <Button testID="create-project" label={t('create')} onPress={create} busy={busy} disabled={!name.trim()} />
    </Screen>
  );
}
