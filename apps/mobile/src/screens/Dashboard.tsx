import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import {
  activityFeed,
  budgetLevel,
  canAddExpenses,
  percentOf,
  reminderMessage,
  settlementSummaryMessage,
  summarize,
  whatsappLink,
  type ProjectState,
} from '@bm/core';
import { Banner, Button, Card, Divider, Empty, Fab, Row, Screen, Section, Txt } from '../components/ui';
import { useSettings } from '../lib/settings';
import { useProject, useWorkspace } from '../lib/workspace';
import { categoryLabel, errorText, money, personName } from '../lib/format';
import { errorKey } from '../lib/i18n';
import { SyncBanner } from '../components/SyncBanner';

export function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const { theme } = useSettings();
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View style={{ height: 8, backgroundColor: theme.surfaceAlt, borderRadius: 4, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: 8, backgroundColor: color }} />
    </View>
  );
}

export function ReadOnlyBanner({ state }: { state: ProjectState }) {
  const { t } = useSettings();
  return state.status !== 'active' ? <Banner testID="read-only" kind="warn" text={t('readOnly')} /> : null;
}

export function RejectedList({ projectId }: { projectId: string }) {
  const { t } = useSettings();
  const { sync } = useProject(projectId);
  if (!sync || sync.doc.rejected.length === 0) return null;
  return (
    <Card testID="rejected-list">
      <Txt weight="semibold">{t('refusedTitle')}</Txt>
      {sync.doc.rejected.map((r) => (
        <Row key={r.op.id} style={{ justifyContent: 'space-between' }}>
          <Txt size={13} style={{ flex: 1 }}>
            {t(errorKey(r.code))}
          </Txt>
          <Button small kind="ghost" label={t('dismiss')} onPress={() => void sync.dismissRejected(r.op.id)} />
        </Row>
      ))}
    </Card>
  );
}

export function Dashboard({ projectId }: { projectId: string }) {
  const { t, theme, settings } = useSettings();
  const ws = useWorkspace();
  const { sync, state } = useProject(projectId);
  const [error, setError] = useState<string | null>(null);
  if (!state || !sync) return null;
  const lang = settings.lang;
  const me = ws.userId;
  const cur = state.currency;
  const sum = summarize(state, me);
  const myNet = sum.net[me] ?? 0;
  const level = budgetLevel(sum.groupTotal, sum.budgetTotal);
  const isGroup = state.type === 'group';
  const writable = state.status === 'active';
  const name = (id: string) => personName(state, id, me, t);
  const balanced = Object.values(sum.net).reduce((a, v) => a + v, 0) === 0;

  const awaiting = state.settlementOrder
    .map((id) => state.settlements[id]!)
    .filter((s) => !s.cancelled && s.parts.some((p) => p.to === me && p.status === 'pending'));

  async function respond(settlementId: string, response: 'confirm' | 'dispute') {
    try {
      setError(null);
      await ws.submit(projectId, 'settlement.respond', { settlementId, response });
    } catch (e) {
      setError(errorText(e, t));
    }
  }

  const feed = activityFeed(sync.doc.confirmed, sync.confirmed ?? state).slice(0, 15);
  const categories = Object.entries(isGroup ? sum.groupByCategory : sum.groupByCategory).sort((a, b) => b[1] - a[1]);

  return (
    <Screen
      footer={writable && canAddExpenses(state, me) ? <Fab testID="add-expense" label={t('addExpense')} onPress={() => router.push(`/project/${projectId}/expense`)} /> : null}
    >
      <SyncBanner />
      <ReadOnlyBanner state={state} />
      <RejectedList projectId={projectId} />
      {error ? <Banner kind="error" text={error} /> : null}

      <Card testID="totals">
        <Txt muted size={13}>
          {isGroup ? t('groupTotal') : t('expenses')}
        </Txt>
        <Txt testID="group-total" weight="bold" size={28}>
          {money(sum.groupTotal, lang, cur)}
        </Txt>
        {sum.budgetTotal !== null ? (
          <>
            <Bar value={sum.groupTotal} max={sum.budgetTotal} color={level === 'over' ? theme.negative : level === 'near' ? theme.warning : theme.positive} />
            <Txt testID="budget-status" size={13} color={level === 'over' ? theme.negative : level === 'near' ? theme.warning : theme.textMuted}>
              {sum.budgetRemaining! >= 0
                ? t('budgetLeft', { amount: money(sum.budgetRemaining!, lang, cur), budget: money(sum.budgetTotal, lang, cur) })
                : t('budgetOver', { amount: money(-sum.budgetRemaining!, lang, cur) })}
            </Txt>
          </>
        ) : (
          <Txt size={13} muted>
            {t('noBudget')}
          </Txt>
        )}
        {isGroup ? (
          <>
            <Divider />
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt muted>{t('myPersonalTotal')}</Txt>
              <Txt testID="my-personal-total" weight="semibold">
                {money(sum.myPersonalTotal, lang, cur)}
              </Txt>
            </Row>
            {sum.contributions[me] ? (
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt muted>{t('myContribution')}</Txt>
                <Txt weight="semibold">{money(sum.contributions[me]!, lang, cur)}</Txt>
              </Row>
            ) : null}
          </>
        ) : null}
      </Card>

      {isGroup ? (
        <Card testID="my-balance">
          <Txt muted size={13}>
            {myNet > 0 ? t('youAreOwed') : myNet < 0 ? t('youOwe') : t('allSettled')}
          </Txt>
          {myNet !== 0 ? (
            <Txt testID="my-net" weight="bold" size={24} color={myNet > 0 ? theme.positive : theme.negative}>
              {money(Math.abs(myNet), lang, cur)}
            </Txt>
          ) : null}
          {writable ? (
            <Row wrap>
              <Button testID="settle-up" small label={t('recordPayment')} onPress={() => router.push(`/project/${projectId}/settle?kind=payment`)} />
              <Button testID="give-contribution" small kind="secondary" label={t('recordContribution')} onPress={() => router.push(`/project/${projectId}/settle?kind=contribution`)} />
            </Row>
          ) : null}
        </Card>
      ) : null}

      {awaiting.length ? (
        <Section title={t('awaitingYou')}>
          {awaiting.map((s) => {
            const part = s.parts.find((p) => p.to === me)!;
            return (
              <Card key={s.id} testID={`awaiting-${s.id}`}>
                <Txt>
                  {name(s.from)} → {t('you')}: <Txt weight="semibold">{money(part.amount, lang, cur)}</Txt> · {s.method} · {t(s.kind)}
                </Txt>
                {writable ? (
                  <Row>
                    <Button testID="confirm-payment" small label={t('confirm')} onPress={() => void respond(s.id, 'confirm')} />
                    <Button testID="dispute-payment" small kind="secondary" label={t('dispute')} onPress={() => void respond(s.id, 'dispute')} />
                  </Row>
                ) : null}
              </Card>
            );
          })}
        </Section>
      ) : null}

      {isGroup ? (
        <Section
          title={t('suggestedPayments')}
          right={<Button small kind="ghost" label={t('shareSummary')} onPress={() => void Linking.openURL(whatsappLink(settlementSummaryMessage(state, sum.suggestedPayments, lang)))} />}
        >
          {sum.suggestedPayments.length === 0 ? (
            <Card>
              <Txt muted>{t('everyoneSettled')}</Txt>
            </Card>
          ) : (
            sum.suggestedPayments.map((p) => (
              <Card key={`${p.from}-${p.to}`} testID="suggested-payment">
                <Txt>
                  {name(p.from)} → {name(p.to)}: <Txt weight="semibold">{money(p.amount, lang, cur)}</Txt>
                </Txt>
                <Row>
                  <Button
                    small
                    kind="secondary"
                    label={t('remind')}
                    onPress={() => void Linking.openURL(whatsappLink(reminderMessage(state, p, lang), state.members[p.from]?.profile.whatsapp))}
                  />
                  {writable && (p.from === me || p.to === me) ? (
                    <Button
                      small
                      label={t('settleUp')}
                      onPress={() => router.push(`/project/${projectId}/settle?kind=payment&from=${p.from}&to=${p.to}&amount=${p.amount}`)}
                    />
                  ) : null}
                </Row>
              </Card>
            ))
          )}
          <Txt size={12} muted>
            {balanced ? `✓ ${t('booksBalanced')}` : '⚠'}
          </Txt>
        </Section>
      ) : null}

      {categories.length ? (
        <Section title={t('byCategory')}>
          <Card>
            {categories.map(([catId, amount]) => {
              const budget = state.budget.categories[catId];
              return (
                <View key={catId} style={{ gap: 4 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt>{categoryLabel(state.categories[catId], lang)}</Txt>
                    <Txt weight="medium">
                      {money(amount, lang, cur)}
                      {budget ? ` / ${money(budget, lang, cur)}` : ` · ${percentOf(amount, sum.groupTotal)}%`}
                    </Txt>
                  </Row>
                  <Bar value={amount} max={budget ?? sum.groupTotal} color={budget && amount >= budget ? theme.negative : theme.primary} />
                </View>
              );
            })}
          </Card>
        </Section>
      ) : null}

      {isGroup && Object.keys(sum.groupPaidByMember).length ? (
        <Section title={t('byMember')}>
          <Card>
            {Object.entries(sum.groupPaidByMember)
              .sort((a, b) => b[1] - a[1])
              .map(([id, amount]) => (
                <Row key={id} style={{ justifyContent: 'space-between' }}>
                  <Txt>{name(id)}</Txt>
                  <Txt weight="medium">{money(amount, lang, cur)}</Txt>
                </Row>
              ))}
          </Card>
        </Section>
      ) : null}

      <Section title={t('activity')}>
        {feed.length === 0 ? (
          <Empty text={t('noActivity')} />
        ) : (
          <Card testID="activity">
            {feed.map((item) => (
              <Txt key={item.opId} size={13}>
                {item.kind === 'expense'
                  ? `${name(item.actorId)} · ${t(item.action === 'create' ? 'vCreate' : item.action === 'edit' ? 'vEdit' : item.action === 'override' ? 'vOverride' : item.action === 'delete' ? 'vDelete' : 'vRestore')} · ${item.description || categoryLabel(state.categories[item.categoryId], lang)} · ${money(item.amount, lang, cur)}`
                  : `${name(item.actorId)} · ${t(item.settlementKind)} · ${t(item.action === 'record' ? 'pending' : item.action === 'confirm' ? 'confirmed' : item.action === 'dispute' ? 'disputed' : 'cancelled')} · ${money(item.amount, lang, cur)}`}
              </Txt>
            ))}
          </Card>
        )}
      </Section>
    </Screen>
  );
}
