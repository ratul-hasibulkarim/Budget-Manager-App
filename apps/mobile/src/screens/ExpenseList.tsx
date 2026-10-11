import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { canAddExpenses, currentVersion, isAdmin, type Expense, type ProjectState } from '@bm/core';
import { Button, Card, Empty, Fab, Row, Screen, Txt } from '../components/ui';
import { SyncBanner } from '../components/SyncBanner';
import { useSettings } from '../lib/settings';
import { useProject, useWorkspace } from '../lib/workspace';
import { categoryLabel, money, personName, showDate } from '../lib/format';
import { ReadOnlyBanner, RejectedList } from './Dashboard';

export function ExpenseList({ projectId }: { projectId: string }) {
  const { t } = useSettings();
  const ws = useWorkspace();
  const { state, sync } = useProject(projectId);
  const [showDeleted, setShowDeleted] = useState(false);
  if (!state || !sync) return null;
  const me = ws.userId;
  const all = [...state.expenseOrder].reverse().map((id) => state.expenses[id]!);
  // Newest date first; entries hidden from this viewer (others' personal costs) are not listed.
  const visible = all.filter((e) => currentVersion(e).data).sort((a, b) => currentVersion(b).data!.date.localeCompare(currentVersion(a).data!.date));
  const deleted = all.filter((e) => currentVersion(e).kind === 'delete' && (e.createdBy === me || isAdmin(state, me)) && e.versions.some((v) => v.data));

  return (
    <Screen
      footer={state.status === 'active' && canAddExpenses(state, me) ? <Fab testID="add-expense" label={t('addExpense')} onPress={() => router.push(`/project/${projectId}/expense`)} /> : null}
    >
      <SyncBanner />
      <ReadOnlyBanner state={state} />
      <RejectedList projectId={projectId} />
      {visible.length === 0 ? <Empty text={t('noExpenses')} /> : visible.map((e) => <ExpenseItem key={e.id} expense={e} state={state} projectId={projectId} pending={isPendingExpense(sync.doc.pending, e.id)} />)}
      {deleted.length ? (
        <>
          <Button small kind="ghost" testID="toggle-deleted" label={`${t('deleted')} (${deleted.length})`} onPress={() => setShowDeleted((v) => !v)} />
          {showDeleted ? deleted.map((e) => <ExpenseItem key={e.id} expense={e} state={state} projectId={projectId} pending={false} />) : null}
        </>
      ) : null}
    </Screen>
  );
}

function isPendingExpense(pending: { payload: unknown }[], expenseId: string) {
  return pending.some((o) => (o.payload as { expenseId?: string }).expenseId === expenseId);
}

function ExpenseItem({ expense, state, projectId, pending }: { expense: Expense; state: ProjectState; projectId: string; pending: boolean }) {
  const { t, theme, settings } = useSettings();
  const ws = useWorkspace();
  const v = currentVersion(expense);
  const data = v.data ?? [...expense.versions].reverse().find((x) => x.data)?.data;
  if (!data) return null;
  const lang = settings.lang;
  const deleted = v.kind === 'delete';
  const payers = data.payers.map((p) => personName(state, p.memberId, ws.userId, t)).join(', ');
  return (
    <Pressable testID={`expense-${data.description || expense.id}`} onPress={() => router.push(`/project/${projectId}/entry?expenseId=${expense.id}`)}>
      <Card style={{ opacity: deleted ? 0.6 : 1 }}>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Txt weight="semibold" numberOfLines={1} style={{ textDecorationLine: deleted ? 'line-through' : 'none' }}>
              {data.description || categoryLabel(state.categories[data.categoryId], lang)}
            </Txt>
            <Txt size={13} muted numberOfLines={1}>
              {categoryLabel(state.categories[data.categoryId], lang)} · {showDate(data.date, lang)} · {t('paidBy')}: {payers}
            </Txt>
            {data.note ? (
              <Txt size={13} muted numberOfLines={2}>
                📝 {data.note}
              </Txt>
            ) : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Txt weight="bold" size={16}>
              {money(data.amount, lang, state.currency)}
            </Txt>
            {state.type === 'group' ? (
              <Txt size={11} color={data.scope === 'group' ? theme.primary : theme.warning}>
                {data.scope === 'group' ? t('scopeGroup') : t('scopePersonal')}
              </Txt>
            ) : null}
            <Txt size={11} muted>
              {deleted ? t('deleted') : pending ? `⏳ ${t('savedOnPhone')}` : v.kind === 'override' ? t('overridden') : v.version > 1 ? t('edited') : '✓'}
            </Txt>
          </View>
        </Row>
      </Card>
    </Pressable>
  );
}
