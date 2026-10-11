import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { canAddExpenses, currentVersion, isAdmin } from '@bm/core';
import { Banner, Button, Card, Divider, Row, Screen, Txt } from '../../../components/ui';
import { useSettings } from '../../../lib/settings';
import { useProject, useWorkspace } from '../../../lib/workspace';
import { categoryLabel, errorText, money, personName, showDate } from '../../../lib/format';
import type { TKey } from '../../../lib/i18n';

const KIND: Record<string, TKey> = { create: 'vCreate', edit: 'vEdit', override: 'vOverride', delete: 'vDelete', restore: 'vRestore' };

/** Expense details with its full version history (who changed what, and restore). */
export default function EntryScreen() {
  const { id, expenseId } = useLocalSearchParams<{ id: string; expenseId: string }>();
  const { t, settings, theme } = useSettings();
  const ws = useWorkspace();
  const { state } = useProject(id);
  const [error, setError] = useState<string | null>(null);
  const e = state?.expenses[expenseId];
  if (!state || !e) return null;
  const me = ws.userId;
  const lang = settings.lang;
  const cur = currentVersion(e);
  const data = cur.data;
  const owner = e.createdBy === me && canAddExpenses(state, me);
  const canChange = state.status === 'active' && (owner || isAdmin(state, me));
  const name = (uid: string) => personName(state, uid, me, t);

  async function restore(version: number) {
    try {
      setError(null);
      await ws.submit(id, 'expense.restore', { expenseId, version });
    } catch (err) {
      setError(errorText(err, t));
    }
  }

  return (
    <Screen>
      {error ? <Banner kind="error" text={error} /> : null}
      {data ? (
        <Card testID="entry-current">
          <Txt weight="bold" size={22}>
            {money(data.amount, lang, state.currency)}
          </Txt>
          <Txt weight="semibold">{data.description || categoryLabel(state.categories[data.categoryId], lang)}</Txt>
          <Txt muted>
            {categoryLabel(state.categories[data.categoryId], lang)} · {showDate(data.date, lang)} · {data.scope === 'group' ? t('scopeGroup') : t('scopePersonal')}
          </Txt>
          {data.note ? <Txt>📝 {data.note}</Txt> : null}
          <Divider />
          <Txt weight="medium">{t('paidBy')}</Txt>
          {data.payers.map((p) => (
            <Row key={p.memberId} style={{ justifyContent: 'space-between' }}>
              <Txt>{name(p.memberId)}</Txt>
              <Txt>{money(p.amount, lang, state.currency)}</Txt>
            </Row>
          ))}
          <Txt weight="medium">{t('forWhom')}</Txt>
          {data.beneficiaries.map((b) => (
            <Row key={b.memberId} style={{ justifyContent: 'space-between' }}>
              <Txt>{name(b.memberId)}</Txt>
              <Txt>{money(b.amount, lang, state.currency)}</Txt>
            </Row>
          ))}
          {canChange ? <Button testID="edit-expense" label={t('editExpense')} onPress={() => router.push(`/project/${id}/expense?expenseId=${expenseId}`)} /> : null}
        </Card>
      ) : (
        <Banner kind="warn" text={cur.kind === 'delete' ? t('deleted') : t('hiddenEntry')} />
      )}

      <Txt weight="semibold" size={16}>
        {t('history')}
      </Txt>
      {[...e.versions].reverse().map((v) => (
        <Card key={v.version} testID={`version-${v.version}`}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt weight="medium">
              {t('version', { n: v.version })} · {t(KIND[v.kind]!)}
            </Txt>
            <Txt size={12} muted>
              {new Date(v.at).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB')}
            </Txt>
          </Row>
          <Txt size={13} muted>
            {name(v.by)}
            {v.data ? ` · ${money(v.data.amount, lang, state.currency)} · ${v.data.description || categoryLabel(state.categories[v.data.categoryId], lang)}` : ''}
          </Txt>
          {v.concurrent ? (
            <Txt size={12} color={theme.warning}>
              {t('concurrentEdit')}
            </Txt>
          ) : null}
          {canChange && v.kind !== 'delete' && v.version !== cur.version && (v.data || v.hidden) ? (
            <Button testID={`restore-${v.version}`} small kind="secondary" label={t('restoreThis')} onPress={() => void restore(v.version)} />
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
