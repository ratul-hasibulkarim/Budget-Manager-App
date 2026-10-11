import { useState } from 'react';
import { TextInput } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { isAdmin, joinOrder, newId, type ProjectState } from '@bm/core';
import { Banner, Button, Card, Chip, Field, Row, Screen, Txt } from '../../../components/ui';
import { useSettings } from '../../../lib/settings';
import { useProject, useWorkspace } from '../../../lib/workspace';
import { errorText, isoDate, money, parseAmount, personName } from '../../../lib/format';
import { FONT } from '../../../lib/theme';

/**
 * Record a payment (one receiver) or a contribution (one or more receivers at once).
 * Neither is a cost: they move balances and, for contributions, count as the giver's contribution.
 */
export default function Settle() {
  const params = useLocalSearchParams<{ id: string; kind?: string; from?: string; to?: string; amount?: string }>();
  const { t, settings, theme } = useSettings();
  const ws = useWorkspace();
  const { state } = useProject(params.id);
  const me = ws.userId;
  const [kind, setKind] = useState<'payment' | 'contribution'>(params.kind === 'contribution' ? 'contribution' : 'payment');
  const [from, setFrom] = useState(params.from ?? me);
  const initialAmount = params.amount ? (Number(params.amount) / 100).toFixed(2).replace(/\.00$/, '') : '';
  const [amounts, setAmounts] = useState<Record<string, string>>(params.to ? { [params.to]: initialAmount } : {});
  const [method, setMethod] = useState('bKash');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const lang = settings.lang;
  const people = joinOrder(state).filter((uid) => state.members[uid]?.status === 'active' || uid === from);
  const receivers = Object.keys(amounts);
  const parts = receivers.map((to) => ({ to, amount: parseAmount(amounts[to] ?? '') }));
  const valid = parts.length > 0 && parts.every((p) => p.amount !== null) && !receivers.includes(from);
  const total = parts.reduce((a, p) => a + (p.amount ?? 0), 0);
  const admin = isAdmin(state, me);

  function toggleReceiver(uid: string) {
    setAmounts((prev) => {
      if (uid in prev) {
        const { [uid]: _drop, ...rest } = prev;
        return rest;
      }
      // A payment goes to one person; a contribution can go to several.
      return kind === 'payment' ? { [uid]: prev[Object.keys(prev)[0] ?? ''] ?? '' } : { ...prev, [uid]: '' };
    });
  }

  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      await ws.submit(params.id, 'settlement.record', {
        settlementId: newId(),
        kind,
        from,
        parts: parts.map((p) => ({ to: p.to, amount: p.amount! })),
        method,
        note: note.trim() || undefined,
        date: isoDate(),
      });
      router.back();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Row>
        <Chip testID="kind-payment" label={t('payment')} selected={kind === 'payment'} onPress={() => (setKind('payment'), setAmounts({}))} />
        <Chip testID="kind-contribution" label={t('contribution')} selected={kind === 'contribution'} onPress={() => (setKind('contribution'), setAmounts({}))} />
      </Row>
      {kind === 'contribution' ? <Banner text={t('contributionHint')} /> : null}
      {admin ? (
        <Card>
          <Txt weight="medium">{t('from')}</Txt>
          <Row wrap>
            {people.map((uid) => (
              <Chip key={uid} label={personName(state, uid, me, t)} selected={from === uid} onPress={() => setFrom(uid)} />
            ))}
          </Row>
        </Card>
      ) : null}
      <Card testID="receivers">
        <Txt weight="medium">{t('to')}</Txt>
        {people
          .filter((uid) => uid !== from)
          .map((uid) => (
            <Row key={uid} style={{ justifyContent: 'space-between' }}>
              <Chip testID={`to-${state.members[uid]?.profile.name ?? uid}`} label={personName(state, uid, me, t)} selected={uid in amounts} onPress={() => toggleReceiver(uid)} />
              {uid in amounts ? (
                <TextInput
                  testID={`amount-${state.members[uid]?.profile.name ?? uid}`}
                  accessibilityLabel={t('amount')}
                  value={amounts[uid]}
                  onChangeText={(v) => setAmounts((prev) => ({ ...prev, [uid]: v }))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  style={{ fontFamily: FONT.regular, color: theme.text, width: 110, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, textAlign: 'right' }}
                />
              ) : null}
            </Row>
          ))}
        {total > 0 ? <Txt weight="semibold">{money(total, lang, state.currency)}</Txt> : null}
      </Card>
      <Card>
        <Txt weight="medium">{t('method')}</Txt>
        <Row wrap>
          {['bKash', 'Nagad', t('cash'), t('bank'), t('other')].map((m) => (
            <Chip key={m} label={m} selected={method === m} onPress={() => setMethod(m)} />
          ))}
        </Row>
      </Card>
      <Field label={`${t('note')} ${t('optional')}`} value={note} onChangeText={setNote} />
      <SettlementHistory state={state} me={me} />
      {error ? <Banner kind="error" text={error} /> : null}
      <Button testID="save-settlement" label={t('save')} onPress={() => void save()} busy={busy} disabled={!valid || state.status !== 'active'} />
    </Screen>
  );
}

function SettlementHistory({ state, me }: { state: ProjectState; me: string }) {
  const { t, settings, theme } = useSettings();
  const ws = useWorkspace();
  const list = [...state.settlementOrder].reverse().map((id) => state.settlements[id]!).filter((s) => s.from === me || s.parts.some((p) => p.to === me));
  if (!list.length) return null;
  return (
    <Card>
      <Txt weight="medium">{t('payments')}</Txt>
      {list.map((s) => (
        <Row key={s.id} style={{ justifyContent: 'space-between' }} wrap>
          <Txt size={13} style={{ flex: 1 }}>
            {t(s.kind)} · {personName(state, s.from, me, t)} → {s.parts.map((p) => `${personName(state, p.to, me, t)} ${money(p.amount, settings.lang, state.currency)} (${t(s.cancelled ? 'cancelled' : p.status)})`).join(', ')}
          </Txt>
          {!s.cancelled && !s.parts.some((p) => p.status === 'confirmed') && (s.recordedBy === me || s.from === me) && state.status === 'active' ? (
            <Button small kind="ghost" label={t('cancel')} onPress={() => void ws.submit(state.id, 'settlement.cancel', { settlementId: s.id }).catch(() => {})} />
          ) : null}
          {s.parts.some((p) => p.status === 'disputed') ? <Txt size={12} color={theme.negative}>{t('disputed')}</Txt> : null}
        </Row>
      ))}
    </Card>
  );
}
