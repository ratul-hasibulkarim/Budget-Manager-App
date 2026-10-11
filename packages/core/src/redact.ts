import { isAdmin, type ProjectState } from './model';
import type { StoredOp } from './ops';
import { effectOf } from './reducer';

/**
 * Prepares an op for a specific viewer before it leaves the server:
 *  - Personal-scope expenses are visible only to the people involved (payers, beneficiaries,
 *    and whoever entered/edited it). Everyone else receives only the effect on balances.
 *  - A member's NID is visible only to that member and to admins.
 * `state` is the server's current full state of the project.
 */
export function redactFor(op: StoredOp, viewerId: string, state: ProjectState): StoredOp {
  if (op.type === 'expense.create' || op.type === 'expense.update') {
    const data = op.payload.data;
    if (!data || data.scope !== 'personal') return op;
    const createdBy = op.type === 'expense.create' ? op.actorId : state.expenses[op.payload.expenseId]?.createdBy;
    const involved = new Set<string>([
      op.actorId,
      ...(createdBy ? [createdBy] : []),
      ...data.payers.map((p) => p.memberId),
      ...data.beneficiaries.map((b) => b.memberId),
    ]);
    if (involved.has(viewerId)) return op;
    const { data: _hidden, ...rest } = op.payload;
    return { ...op, payload: { ...rest, hidden: { effect: effectOf(data) } } } as StoredOp;
  }
  if (op.type === 'member.updateProfile') {
    const { nid, ...publicProfile } = op.payload.profile;
    if (nid === undefined || viewerId === op.actorId || isAdmin(state, viewerId)) return op;
    return { ...op, payload: { profile: publicProfile } };
  }
  return op;
}
