import { currentVersion, joinOrder, type ProjectState } from './model';
import { sum, type Minor } from './money';

/**
 * Net balance of a member = what they paid − their share of costs
 *                          + confirmed settlements/contributions they gave
 *                          − confirmed settlements/contributions they received.
 * Positive: the group owes them. Negative: they owe the group. All nets add up to exactly 0.
 */
export function netBalances(state: ProjectState): Record<string, Minor> {
  const net: Record<string, Minor> = {};
  for (const m of Object.values(state.members)) if (m.joinIndex !== null) net[m.userId] = 0;
  const add = (id: string, v: Minor) => {
    net[id] = (net[id] ?? 0) + v;
  };
  for (const id of state.expenseOrder) {
    const v = currentVersion(state.expenses[id]!);
    for (const [member, delta] of Object.entries(v.effect)) add(member, delta);
  }
  for (const id of state.settlementOrder) {
    const s = state.settlements[id]!;
    if (s.cancelled) continue;
    for (const p of s.parts) {
      if (p.status !== 'confirmed') continue;
      add(s.from, p.amount);
      add(p.to, -p.amount);
    }
  }
  return net;
}

export function hasPendingSettlement(state: ProjectState, userId: string): boolean {
  return state.settlementOrder.some((id) => {
    const s = state.settlements[id]!;
    return !s.cancelled && s.parts.some((p) => p.status === 'pending' && (s.from === userId || p.to === userId));
  });
}

/** Settled = net balance exactly zero and no payment waiting for confirmation. */
export function isSettled(state: ProjectState, userId: string): boolean {
  return (netBalances(state)[userId] ?? 0) === 0 && !hasPendingSettlement(state, userId);
}

export interface Transfer {
  from: string;
  to: string;
  amount: Minor;
}

/**
 * Fewest-payments suggestion: repeatedly matches the largest debtor with the largest creditor.
 * Produces at most n−1 payments and clears every balance exactly. Ties use join order so all
 * devices suggest the same payments.
 */
export function simplifyDebts(net: Record<string, Minor>, order: readonly string[] = []): Transfer[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const byRank = (a: string, b: string) =>
    (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER) || (a < b ? -1 : a > b ? 1 : 0);
  const debtors = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, left: -v }));
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, left: v }));
  const transfers: Transfer[] = [];
  const pick = (list: { id: string; left: number }[]) =>
    list.filter((x) => x.left > 0).sort((a, b) => b.left - a.left || byRank(a.id, b.id))[0];
  for (;;) {
    const d = pick(debtors);
    const c = pick(creditors);
    if (!d || !c) break;
    const amount = Math.min(d.left, c.left);
    transfers.push({ from: d.id, to: c.id, amount });
    d.left -= amount;
    c.left -= amount;
  }
  return transfers;
}

export interface ProjectSummary {
  /** Sum of full amounts of group-scope expenses (this is what the budget is measured against). */
  groupTotal: Minor;
  groupByCategory: Record<string, Minor>;
  /** Day (YYYY-MM-DD) -> group spending. */
  groupByDay: Record<string, Minor>;
  /** How much each member paid toward group costs. */
  groupPaidByMember: Record<string, Minor>;
  /** Each member's share of group costs. */
  groupShareByMember: Record<string, Minor>;
  /** The viewer's own share of personal-scope expenses. */
  myPersonalTotal: Minor;
  myPersonalByCategory: Record<string, Minor>;
  /** Confirmed contributions given, per member. */
  contributions: Record<string, Minor>;
  net: Record<string, Minor>;
  suggestedPayments: Transfer[];
  budgetTotal: Minor | null;
  budgetRemaining: Minor | null;
  categoryBudgets: { categoryId: string; budget: Minor; spent: Minor }[];
}

export function summarize(state: ProjectState, viewerId: string): ProjectSummary {
  const groupByCategory: Record<string, Minor> = {};
  const groupByDay: Record<string, Minor> = {};
  const groupPaidByMember: Record<string, Minor> = {};
  const groupShareByMember: Record<string, Minor> = {};
  const myPersonalByCategory: Record<string, Minor> = {};
  let groupTotal = 0;
  let myPersonalTotal = 0;
  const inc = (rec: Record<string, Minor>, key: string, v: Minor) => {
    rec[key] = (rec[key] ?? 0) + v;
  };

  for (const id of state.expenseOrder) {
    const data = currentVersion(state.expenses[id]!).data;
    if (!data) continue; // deleted, or hidden from this viewer
    if (data.scope === 'group') {
      groupTotal += data.amount;
      inc(groupByCategory, data.categoryId, data.amount);
      inc(groupByDay, data.date, data.amount);
      for (const p of data.payers) inc(groupPaidByMember, p.memberId, p.amount);
      for (const b of data.beneficiaries) inc(groupShareByMember, b.memberId, b.amount);
    } else {
      const mine = sum(data.beneficiaries.filter((b) => b.memberId === viewerId).map((b) => b.amount));
      if (mine > 0) {
        myPersonalTotal += mine;
        inc(myPersonalByCategory, data.categoryId, mine);
      }
    }
  }

  const contributions: Record<string, Minor> = {};
  for (const id of state.settlementOrder) {
    const s = state.settlements[id]!;
    if (s.cancelled || s.kind !== 'contribution') continue;
    for (const p of s.parts) if (p.status === 'confirmed') inc(contributions, s.from, p.amount);
  }

  const net = netBalances(state);
  const { total, categories } = state.budget;
  return {
    groupTotal,
    groupByCategory,
    groupByDay,
    groupPaidByMember,
    groupShareByMember,
    myPersonalTotal,
    myPersonalByCategory,
    contributions,
    net,
    suggestedPayments: simplifyDebts(net, joinOrder(state)),
    budgetTotal: total,
    budgetRemaining: total === null ? null : total - groupTotal,
    categoryBudgets: Object.entries(categories).map(([categoryId, budget]) => ({
      categoryId,
      budget,
      spent: groupByCategory[categoryId] ?? 0,
    })),
  };
}

/** Budget alert level: 'over' at 100%+, 'near' at 80%+. Uses exact integer comparison. */
export function budgetLevel(spent: Minor, budget: Minor | null): 'ok' | 'near' | 'over' {
  if (budget === null || budget <= 0) return 'ok';
  if (spent >= budget) return 'over';
  if (spent * 5 >= budget * 4) return 'near';
  return 'ok';
}
