import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { expensesCsv, isAdmin, type OpPayloads, type OpType } from '@bm/core';
import { Banner, Button, Card, Field, Screen, Section, Txt } from '../../../components/ui';
import { useSettings } from '../../../lib/settings';
import { useProject, useWorkspace } from '../../../lib/workspace';
import { ask, categoryLabel, errorText, parseAmount } from '../../../lib/format';
import { saveTextFile } from '../../../lib/files';

export default function ProjectSettings() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, settings } = useSettings();
  const ws = useWorkspace();
  const { state } = useProject(id);
  const [name, setName] = useState(state?.name ?? '');
  const [description, setDescription] = useState(state?.description ?? '');
  const [whatsapp, setWhatsapp] = useState(state?.links.whatsapp ?? '');
  const [telegram, setTelegram] = useState(state?.links.telegram ?? '');
  const [budget, setBudget] = useState(state?.budget.total ? (state.budget.total / 100).toString() : '');
  const [catBudgets, setCatBudgets] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(state?.budget.categories ?? {}).map(([k, v]) => [k, (v / 100).toString()])),
  );
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  if (!state) return null;
  const admin = isAdmin(state, ws.userId);
  const active = state.status === 'active';
  const editable = admin && active;

  async function run<T extends OpType>(type: T, payload: OpPayloads[T]) {
    try {
      setMessage(null);
      await ws.submit(id, type, payload);
      return true;
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e, t) });
      return false;
    }
  }

  async function saveDetails() {
    if (!name.trim()) return setMessage({ kind: 'error', text: t('err_name') });
    const ok = await run('project.update', {
      name: name.trim(),
      description: description.trim() || null,
      links: { whatsapp: whatsapp.trim() || null, telegram: telegram.trim() || null },
    });
    if (ok) setMessage({ kind: 'info', text: t('save') + ' ✓' });
  }

  async function saveBudget() {
    const total = budget.trim() ? parseAmount(budget) : null;
    if (budget.trim() && total === null) return setMessage({ kind: 'error', text: t('err_calc') });
    const categories: Record<string, number> = {};
    for (const [k, v] of Object.entries(catBudgets)) {
      if (!v.trim()) continue;
      const a = parseAmount(v);
      if (a === null) return setMessage({ kind: 'error', text: t('err_calc') });
      categories[k] = a;
    }
    if (await run('project.setBudget', { total, categories })) setMessage({ kind: 'info', text: t('save') + ' ✓' });
  }

  return (
    <Screen>
      {message ? <Banner testID="project-settings-message" kind={message.kind} text={message.text} /> : null}
      {!admin ? <Banner text={t('err_not_admin')} /> : null}
      <Section title={t('details')}>
        <Card>
          <Field testID="edit-name" label={t('projectName')} value={name} onChangeText={setName} editable={editable} />
          <Field label={t('description')} value={description} onChangeText={setDescription} editable={editable} multiline />
          {state.type === 'group' ? (
            <>
              <Field testID="whatsapp-link" label={t('whatsappLink')} value={whatsapp} onChangeText={setWhatsapp} editable={editable} autoCapitalize="none" placeholder="https://chat.whatsapp.com/…" />
              <Field testID="telegram-link" label={t('telegramLink')} value={telegram} onChangeText={setTelegram} editable={editable} autoCapitalize="none" placeholder="https://t.me/+…" />
            </>
          ) : null}
          {editable ? <Button testID="save-details" label={t('save')} onPress={() => void saveDetails()} /> : null}
        </Card>
      </Section>

      <Section title={t('budget')}>
        <Card>
          <Field testID="edit-budget" label={t('totalBudget')} value={budget} onChangeText={setBudget} editable={editable} keyboardType="decimal-pad" />
          {state.categoryOrder
            .map((c) => state.categories[c]!)
            .filter((c) => !c.hidden)
            .map((c) => (
              <Field
                key={c.id}
                label={categoryLabel(c, settings.lang)}
                value={catBudgets[c.id] ?? ''}
                onChangeText={(v) => setCatBudgets((p) => ({ ...p, [c.id]: v }))}
                editable={editable}
                keyboardType="decimal-pad"
              />
            ))}
          {editable ? <Button testID="save-budget" label={t('save')} onPress={() => void saveBudget()} /> : null}
        </Card>
      </Section>

      <Section title={t('archive')}>
        <Card>
          <Button testID="export-csv" kind="secondary" label={t('exportCsv')} onPress={() => void saveTextFile(`${state.name}.csv`, expensesCsv(state), 'text/csv')} />
          {admin && state.status === 'active' ? (
            <Button testID="archive-project" kind="secondary" label={t('archiveProject')} onPress={() => void run('project.archive', {})} />
          ) : null}
          {admin && state.status === 'archived' ? (
            <Button testID="unarchive-project" kind="secondary" label={t('unarchiveProject')} onPress={() => void run('project.unarchive', {})} />
          ) : null}
          {admin && state.status !== 'trashed' ? (
            <Button
              testID="trash-project"
              kind="danger"
              label={t('trashProject')}
              onPress={async () => {
                if (await ask(`${t('trashProject')}? ${t('trashInfo')}`, t('trashProject'), t('cancel'))) {
                  if (await run('project.trash', {})) router.replace('/');
                }
              }}
            />
          ) : null}
          {admin && state.status === 'trashed' ? (
            <Button testID="restore-project" label={t('restoreProject')} onPress={() => void run('project.restore', {})} />
          ) : null}
          <Txt size={12} muted>
            {state.type === 'group' ? `${t('autoArchiveInfo')} ` : ''}
            {t('trashInfo')}
          </Txt>
        </Card>
      </Section>
    </Screen>
  );
}
