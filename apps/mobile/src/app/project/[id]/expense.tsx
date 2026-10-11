import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import {
  autoScope,
  canAddExpenses,
  currentVersion,
  isAdmin,
  isValidDate,
  joinOrder,
  newId,
  resolveSplit,
  SplitError,
  sum,
  type ExpenseData,
  type ExpenseScope,
  type Minor,
  type ProjectState,
  type SplitSpec,
} from '@bm/core';
import { AmountField, Banner, Button, Card, Chip, Field, Row, Screen, Txt } from '../../../components/ui';
import { useSettings } from '../../../lib/settings';
import { useProject, useWorkspace } from '../../../lib/workspace';
import { ask, categoryLabel, errorText, isoDate, money, parseAmount, personName, yesterdayIso } from '../../../lib/format';
import { FONT } from '../../../lib/theme';

type Method = SplitSpec['method'];

interface SplitInput {
  members: string[];
  method: Method;
  /** Per-person text for exact / percent / shares. */
  values: Record<string, string>;
}

function specFromInput(input: SplitInput): SplitSpec | string {
  const ids = input.members;
  if (ids.length === 0) return 'empty';
  switch (input.method) {
    case 'equal':
      return { method: 'equal', members: ids };
    case 'exact': {
      const amounts: Record<string, Minor> = {};
      for (const id of ids) {
        const v = parseAmount(input.values[id] ?? '');
        if (v === null && (input.values[id] ?? '').trim() !== '' && input.values[id] !== '0') return 'bad';
        amounts[id] = v ?? 0;
      }
      return { method: 'exact', amounts };
    }
    case 'percent': {
      const basisPoints: Record<string, number> = {};
      for (const id of ids) {
        const raw = (input.values[id] ?? '').trim();
        if (!/^\d{0,3}(\.\d{1,2})?$/.test(raw)) return 'bad';
        basisPoints[id] = Math.round(Number(raw || '0') * 100);
      }
      return { method: 'percent', basisPoints };
    }
    case 'shares': {
      const shares: Record<string, number> = {};
      for (const id of ids) {
        const raw = (input.values[id] ?? '1').trim();
        if (!/^\d{1,4}$/.test(raw)) return 'bad';
        shares[id] = Number(raw);
      }
      return { method: 'shares', shares };
    }
  }
}

function inputFromSpec(spec: SplitSpec): SplitInput {
  switch (spec.method) {
    case 'equal':
      return { members: spec.members, method: 'equal', values: {} };
    case 'exact':
      return { members: Object.keys(spec.amounts), method: 'exact', values: Object.fromEntries(Object.entries(spec.amounts).map(([k, v]) => [k, (v / 100).toFixed(2).replace(/\.00$/, '')])) };
    case 'percent':
      return { members: Object.keys(spec.basisPoints), method: 'percent', values: Object.fromEntries(Object.entries(spec.basisPoints).map(([k, v]) => [k, String(v / 100)])) };
    case 'shares':
      return { members: Object.keys(spec.shares), method: 'shares', values: Object.fromEntries(Object.entries(spec.shares).map(([k, v]) => [k, String(v)])) };
  }
}

export default function ExpenseEditor() {
  const { id, expenseId } = useLocalSearchParams<{ id: string; expenseId?: string }>();
  const { t, settings } = useSettings();
  const ws = useWorkspace();
  const { state } = useProject(id);
  if (!state) return null;
  return <Editor key={expenseId ?? 'new'} projectId={id} expenseId={expenseId} state={state} me={ws.userId} t={t} lang={settings.lang} />;
}

function Editor({
  projectId,
  expenseId,
  state,
  me,
  t,
  lang,
}: {
  projectId: string;
  expenseId?: string;
  state: ProjectState;
  me: string;
  t: ReturnType<typeof useSettings>['t'];
  lang: 'en' | 'bn';
}) {
  const ws = useWorkspace();
  const { theme } = useSettings();
  const existing = expenseId ? state.expenses[expenseId] : undefined;
  const base = existing ? currentVersion(existing) : undefined;
  const initial = base?.data ?? undefined;
  const isGroup = state.type === 'group';
  const activeIds = joinOrder(state).filter((uid) => state.members[uid]?.status === 'active');
  // People already in an expense stay selectable when editing even if they have left.
  const selectable = useMemo(() => {
    const set = new Set(activeIds);
    if (initial) for (const p of [...initial.payers, ...initial.beneficiaries]) set.add(p.memberId);
    return joinOrder(state).filter((uid) => set.has(uid));
  }, [state, initial, activeIds]);

  const [amountText, setAmountText] = useState(initial ? (initial.amount / 100).toFixed(2).replace(/\.00$/, '') : '');
  const [amount, setAmount] = useState<Minor | null>(initial?.amount ?? null);
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? 'food');
  const [date, setDate] = useState(initial?.date ?? isoDate());
  const [description, setDescription] = useState(initial?.description ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [payers, setPayers] = useState<SplitInput>(initial ? inputFromSpec(initial.payerSplit) : { members: [me], method: 'equal', values: {} });
  const [bens, setBens] = useState<SplitInput>(initial ? inputFromSpec(initial.beneficiarySplit) : { members: activeIds, method: 'equal', values: {} });
  const [manualScope, setManualScope] = useState<ExpenseScope | null>(initial?.scopeSource === 'manual' ? initial.scope : null);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const order = joinOrder(state);
  const payerInput = isGroup ? payers : { members: [me], method: 'equal' as const, values: {} };
  const benInput = isGroup ? bens : { members: [me], method: 'equal' as const, values: {} };
  const payerSpec = specFromInput(payerInput);
  const benSpec = specFromInput(benInput);

  const resolve = (spec: SplitSpec | string) => {
    if (typeof spec === 'string' || amount === null) return null;
    try {
      return resolveSplit(amount, spec, order);
    } catch (e) {
      if (e instanceof SplitError) return null;
      throw e;
    }
  };
  const payerPortions = resolve(payerSpec);
  const benPortions = resolve(benSpec);
  const autoScopeValue = autoScope(state, benInput.members);
  const scope: ExpenseScope = manualScope ?? autoScopeValue;
  const canEdit = !existing || (existing.createdBy === me && canAddExpenses(state, me)) || isAdmin(state, me);
  const writable = state.status === 'active' && canEdit;

  async function save() {
    setError(null);
    if (amount === null) return setError(t('err_calc'));
    if (!isValidDate(date)) return setError(t('err_invalid'));
    if (!payerPortions || !benPortions || typeof payerSpec === 'string' || typeof benSpec === 'string') return setError(t('err_unbalanced'));
    const data: ExpenseData = {
      amount,
      categoryId,
      date,
      description: description.trim() || undefined,
      note: note.trim() || undefined,
      payerSplit: payerSpec,
      beneficiarySplit: benSpec,
      payers: payerPortions,
      beneficiaries: benPortions,
      scope: isGroup ? scope : 'group',
      scopeSource: manualScope ? 'manual' : 'auto',
    };
    setBusy(true);
    try {
      if (existing && base) await ws.submit(projectId, 'expense.update', { expenseId: existing.id, baseVersion: base.version, data });
      else await ws.submit(projectId, 'expense.create', { expenseId: newId(), data });
      router.back();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    if (!(await ask(t('confirmDelete'), t('delete'), t('cancel')))) return;
    try {
      await ws.submit(projectId, 'expense.delete', { expenseId: existing.id });
      router.back();
    } catch (e) {
      setError(errorText(e, t));
    }
  }

  async function addCategory() {
    if (!newCat?.trim()) return;
    const categoryIdNew = newId();
    try {
      await ws.submit(projectId, 'category.add', { categoryId: categoryIdNew, name: newCat.trim() });
      setCategoryId(categoryIdNew);
      setNewCat(null);
    } catch (e) {
      setError(errorText(e, t));
    }
  }

  const categories = state.categoryOrder.map((cid) => state.categories[cid]!).filter((c) => !c.hidden || c.id === categoryId);

  return (
    <Screen>
      <Stack.Screen options={{ title: existing ? t('editExpense') : t('addExpense') }} />
      {!canEdit ? <Banner kind="warn" text={t('canOnlyEditOwn')} /> : null}
      <AmountField
        testID="amount"
        label={t('amount')}
        text={amountText}
        autoFocus={!existing}
        onText={(text, value) => {
          setAmountText(text);
          setAmount(value);
        }}
      />
      <Field testID="description" label={`${t('description')} ${t('optional')}`} value={description} onChangeText={setDescription} />

      <Card>
        <Txt weight="medium">{t('category')}</Txt>
        <Row wrap>
          {categories.map((c) => (
            <Chip key={c.id} testID={`cat-${c.id}`} label={categoryLabel(c, lang)} selected={c.id === categoryId} onPress={() => setCategoryId(c.id)} />
          ))}
          {canAddExpenses(state, me) ? <Chip testID="add-category" label={`+ ${t('addCategory')}`} onPress={() => setNewCat('')} /> : null}
        </Row>
        {newCat !== null ? (
          <Row>
            <View style={{ flex: 1 }}>
              <Field testID="new-category" label={t('categoryName')} value={newCat} onChangeText={setNewCat} autoFocus />
            </View>
            <Button testID="save-category" small label={t('add')} onPress={() => void addCategory()} disabled={!newCat.trim()} />
          </Row>
        ) : null}
      </Card>

      <Card>
        <Txt weight="medium">{t('date')}</Txt>
        <Row wrap>
          <Chip testID="date-today" label={t('today')} selected={date === isoDate()} onPress={() => setDate(isoDate())} />
          <Chip testID="date-yesterday" label={t('yesterday')} selected={date === yesterdayIso()} onPress={() => setDate(yesterdayIso())} />
          <TextInput
            testID="date-input"
            accessibilityLabel={t('date')}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            style={{ fontFamily: FONT.regular, color: theme.text, borderWidth: 1, borderColor: isValidDate(date) ? theme.border : theme.negative, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 130 }}
          />
        </Row>
      </Card>

      {isGroup ? (
        <>
          <SplitEditor
            testID="payers"
            title={t('paidBy')}
            state={state}
            me={me}
            selectable={selectable}
            input={payers}
            onChange={setPayers}
            amount={amount}
            portions={payerPortions}
            methods={['equal', 'exact']}
          />
          <SplitEditor
            testID="beneficiaries"
            title={t('forWhom')}
            state={state}
            me={me}
            selectable={selectable}
            input={bens}
            onChange={setBens}
            amount={amount}
            portions={benPortions}
            methods={['equal', 'exact', 'percent', 'shares']}
          />
          <Chip
            testID="scope-toggle"
            label={`${scope === 'group' ? t('scopeGroup') : t('scopePersonal')} · ${t('tapToSwitch')}`}
            selected={scope === 'group'}
            onPress={() => setManualScope(scope === 'group' ? 'personal' : 'group')}
          />
        </>
      ) : null}

      <Field testID="note" label={`${t('note')} ${t('optional')}`} value={note} onChangeText={setNote} multiline />
      {error ? <Banner testID="expense-error" kind="error" text={error} /> : null}
      {writable ? <Button testID="save-expense" label={t('save')} onPress={() => void save()} busy={busy} disabled={amount === null || !payerPortions || !benPortions} /> : null}
      {existing && writable && base?.kind !== 'delete' ? <Button testID="delete-expense" kind="danger" label={t('delete')} onPress={() => void remove()} /> : null}
    </Screen>
  );
}

function SplitEditor({
  testID,
  title,
  state,
  me,
  selectable,
  input,
  onChange,
  amount,
  portions,
  methods,
}: {
  testID: string;
  title: string;
  state: ProjectState;
  me: string;
  selectable: string[];
  input: SplitInput;
  onChange: (v: SplitInput) => void;
  amount: Minor | null;
  portions: { memberId: string; amount: Minor }[] | null;
  methods: Method[];
}) {
  const { t, settings, theme } = useSettings();
  const lang = settings.lang;
  const label: Record<Method, string> = { equal: t('equal'), exact: t('exact'), percent: t('percent'), shares: t('shares') };
  const toggle = (uid: string) =>
    onChange({ ...input, members: input.members.includes(uid) ? input.members.filter((x) => x !== uid) : [...input.members, uid] });
  const allSelected = selectable.every((uid) => input.members.includes(uid));

  // Running total for exact / percent so the user sees what is left.
  let status: string | null = null;
  let statusBad = false;
  const spec = specFromInput(input);
  if (typeof spec !== 'string' && amount !== null) {
    if (spec.method === 'exact') {
      const total = sum(Object.values(spec.amounts));
      if (total !== amount) {
        statusBad = true;
        status = total < amount ? t('splitRemaining', { amount: money(amount - total, lang, state.currency) }) : t('splitOver', { amount: money(total - amount, lang, state.currency) });
      }
    } else if (spec.method === 'percent') {
      const total = sum(Object.values(spec.basisPoints));
      statusBad = total !== 10000;
      status = t('percentTotal', { value: total / 100 });
    }
  }
  const byId = new Map((portions ?? []).map((p) => [p.memberId, p.amount]));

  return (
    <Card testID={testID}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt weight="medium">{title}</Txt>
        <Row>
          {methods.map((m) => (
            <Chip key={m} testID={`${testID}-method-${m}`} label={label[m]} selected={input.method === m} onPress={() => onChange({ ...input, method: m })} />
          ))}
        </Row>
      </Row>
      <Chip
        testID={`${testID}-all`}
        label={t('everyone')}
        selected={allSelected}
        onPress={() => onChange({ ...input, members: allSelected ? [] : [...selectable] })}
      />
      {selectable.map((uid) => {
        const on = input.members.includes(uid);
        const name = personName(state, uid, me, t);
        return (
          <Row key={uid} style={{ justifyContent: 'space-between' }}>
            <Chip testID={`${testID}-${state.members[uid]?.profile.name ?? uid}`} label={name} selected={on} onPress={() => toggle(uid)} />
            {on && input.method !== 'equal' ? (
              <TextInput
                testID={`${testID}-value-${state.members[uid]?.profile.name ?? uid}`}
                accessibilityLabel={`${name} ${label[input.method]}`}
                value={input.values[uid] ?? (input.method === 'shares' ? '1' : '')}
                onChangeText={(v) => onChange({ ...input, values: { ...input.values, [uid]: v } })}
                keyboardType="decimal-pad"
                placeholder={input.method === 'percent' ? '%' : '0'}
                style={{ fontFamily: FONT.regular, color: theme.text, width: 90, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, textAlign: 'right' }}
              />
            ) : on && byId.has(uid) ? (
              <Txt muted>{money(byId.get(uid)!, lang, state.currency)}</Txt>
            ) : null}
          </Row>
        );
      })}
      {input.method !== 'equal' && portions && input.method !== 'exact'
        ? portions.map((p) => (
            <Txt key={p.memberId} size={12} muted>
              {personName(state, p.memberId, me, t)}: {money(p.amount, lang, state.currency)}
            </Txt>
          ))
        : null}
      {status ? (
        <Txt testID={`${testID}-status`} size={13} color={statusBad ? theme.negative : theme.textMuted}>
          {status}
        </Txt>
      ) : null}
      {typeof spec === 'string' && spec === 'empty' ? (
        <Txt size={13} color={theme.negative}>
          {t('err_unbalanced')}
        </Txt>
      ) : null}
    </Card>
  );
}
