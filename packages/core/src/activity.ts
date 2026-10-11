import { isAdmin, type ExpenseData, type ProjectState } from './model';
import type { Minor } from './money';
import { MONEY_OPS, type StoredOp } from './ops';

export type ActivityItem =
  | {
      kind: 'expense';
      opId: string;
      at: number;
      actorId: string;
      action: 'create' | 'edit' | 'override' | 'delete' | 'restore';
      expenseId: string;
      amount: Minor;
      description: string;
      categoryId: string;
    }
  | {
      kind: 'settlement';
      opId: string;
      at: number;
      actorId: string;
      action: 'record' | 'confirm' | 'dispute' | 'cancel';
      settlementId: string;
      settlementKind: 'payment' | 'contribution';
      from: string;
      amount: Minor;
    };

/**
 * Activity feed: money changes only (joins, leaves and approvals are not shown).
 * Personal expenses the viewer may not see are skipped. Newest first.
 */
export function activityFeed(ops: readonly StoredOp[], state: ProjectState): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const op of ops) {
    if (!MONEY_OPS.has(op.type)) continue;
    if (op.type.startsWith('expense.')) {
      const expenseId = (op.payload as { expenseId: string }).expenseId;
      const e = state.expenses[expenseId];
      if (!e) continue;
      const idx = e.versions.findIndex((v) => v.opId === op.id);
      const v = e.versions[idx];
      if (!v) continue;
      // For a delete, describe what was deleted.
      let data: ExpenseData | null = v.data;
      if (v.kind === 'delete') data = e.versions[idx - 1]?.data ?? null;
      if (!data) continue;
      items.push({
        kind: 'expense',
        opId: op.id,
        at: op.serverAt,
        actorId: op.actorId,
        action: v.kind,
        expenseId,
        amount: data.amount,
        description: data.description ?? '',
        categoryId: data.categoryId,
      });
    } else {
      const settlementId = (op.payload as { settlementId: string }).settlementId;
      const s = state.settlements[settlementId];
      if (!s) continue;
      let action: 'record' | 'confirm' | 'dispute' | 'cancel' = 'record';
      let amount = s.parts.reduce((a, p) => a + p.amount, 0);
      if (op.type === 'settlement.respond') {
        const p = op.payload as { response: 'confirm' | 'dispute' };
        action = p.response;
        amount = s.parts.find((x) => x.to === op.actorId)?.amount ?? 0;
      } else if (op.type === 'settlement.cancel') action = 'cancel';
      items.push({ kind: 'settlement', opId: op.id, at: op.serverAt, actorId: op.actorId, action, settlementId, settlementKind: s.kind, from: s.from, amount });
    }
  }
  return items.reverse();
}

/**
 * Who must be told when an expense change moves balances: the entry's creator, all admins and
 * every member whose balance changed. Returns [] if no balance changed.
 */
export function balanceChangeAudience(
  state: ProjectState,
  expenseId: string,
  before: Record<string, Minor>,
  after: Record<string, Minor>,
): string[] {
  const changed = new Set<string>();
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if ((before[id] ?? 0) !== (after[id] ?? 0)) changed.add(id);
  }
  if (changed.size === 0) return [];
  const e = state.expenses[expenseId];
  if (e) changed.add(e.createdBy);
  for (const m of Object.values(state.members)) if (isAdmin(state, m.userId)) changed.add(m.userId);
  return [...changed];
}
