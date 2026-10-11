import { describe, expect, it } from 'vitest';
import { AUTO_ARCHIVE_AFTER_MS, currentVersion, isSettled, netBalances, summarize } from '../src';
import { Book, DAY, expense, groupWith } from './helpers';

describe('project creation', () => {
  it('only the name is required; creator becomes admin with default categories', () => {
    const b = new Book();
    const s = b.apply('A', 'project.create', { type: 'group', name: '  Cox Trip ', currency: 'BDT' });
    expect(s.name).toBe('Cox Trip');
    expect(s.members.A).toMatchObject({ role: 'admin', status: 'active', canAddExpenses: true, joinIndex: 0 });
    expect(s.categoryOrder).toContain('food');
    expect(s.categoryOrder).toHaveLength(10);
    expect(s.status).toBe('active');
    expect(s.budget.total).toBeNull();
  });
  it('rejects a blank name, bad currency and duplicates', () => {
    const b = new Book();
    expect(b.refuse('A', 'project.create', { type: 'group', name: '   ', currency: 'BDT' })).toBe('invalid');
    expect(b.refuse('A', 'project.create', { type: 'group', name: 'X', currency: 'taka' })).toBe('invalid');
    b.apply('A', 'project.create', { type: 'group', name: 'X', currency: 'BDT' });
    expect(b.refuse('A', 'project.create', { type: 'group', name: 'X', currency: 'BDT' })).toBe('exists');
  });
  it('admin edits details and links; members cannot', () => {
    const b = groupWith(['A', 'B']);
    b.apply('A', 'project.update', { description: 'Beach', links: { whatsapp: 'https://chat.whatsapp.com/x', telegram: 'https://t.me/+y' } });
    expect(b.s.links).toEqual({ whatsapp: 'https://chat.whatsapp.com/x', telegram: 'https://t.me/+y' });
    b.apply('A', 'project.update', { links: { whatsapp: null } });
    expect(b.s.links.whatsapp).toBeUndefined();
    expect(b.refuse('B', 'project.update', { name: 'Mine' })).toBe('not_admin');
  });
});

describe('joining and approval', () => {
  it('join request waits for admin approval; wrong code refused', () => {
    const b = groupWith(['A']);
    expect(b.refuse('B', 'member.requestJoin', { inviteCode: 'ABCDEFGH' })).toBe('bad_invite'); // no code set yet
    b.apply('A', 'project.setInviteCode', { code: 'ABCDEFGH' });
    expect(b.refuse('B', 'member.requestJoin', { inviteCode: 'WRONGONE' })).toBe('bad_invite');
    b.apply('B', 'member.requestJoin', { inviteCode: 'ABCDEFGH', name: 'Bina' });
    expect(b.s.members.B).toMatchObject({ status: 'pending', joinIndex: null, canAddExpenses: false, profile: { name: 'Bina' } });
    expect(b.refuse('B', 'member.requestJoin', { inviteCode: 'ABCDEFGH' })).toBe('already_pending');
    expect(b.refuse('B', 'member.updateProfile', { profile: { name: 'x' } })).toBe('not_member');
    b.apply('A', 'member.approve', { userId: 'B' });
    expect(b.s.members.B).toMatchObject({ status: 'active', joinIndex: 1 });
    expect(b.refuse('B', 'member.requestJoin', { inviteCode: 'ABCDEFGH' })).toBe('already_member');
  });
  it('only admins approve or reject; rejected people may ask again', () => {
    const b = groupWith(['A', 'B']);
    b.apply('C', 'member.requestJoin', { inviteCode: 'ABCDEFGH' });
    expect(b.refuse('B', 'member.approve', { userId: 'C' })).toBe('not_admin');
    b.apply('A', 'member.reject', { userId: 'C' });
    expect(b.s.members.C!.status).toBe('rejected');
    b.apply('C', 'member.requestJoin', { inviteCode: 'ABCDEFGH' });
    expect(b.s.members.C!.status).toBe('pending');
  });
  it('turning the invite off blocks new requests', () => {
    const b = groupWith(['A', 'B']);
    b.apply('A', 'project.setInviteCode', { code: null });
    expect(b.refuse('C', 'member.requestJoin', { inviteCode: 'ABCDEFGH' })).toBe('bad_invite');
    expect(b.refuse('A', 'project.setInviteCode', { code: 'abc' })).toBe('invalid');
  });
  it('a member who left re-joins automatically with the same membership and can edit their old entries', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('B', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 300, paidBy: ['B'], forWhom: ['B'] }) });
    b.apply('B', 'member.leave', {});
    expect(b.s.members.B!.status).toBe('left');
    expect(b.refuse('B', 'expense.update', { expenseId: 'e1', baseVersion: 1, data: expense(b.s, { amount: 400, paidBy: ['B'], forWhom: ['B'] }) })).toBe('not_member');
    b.apply('B', 'member.requestJoin', { inviteCode: 'ABCDEFGH' });
    expect(b.s.members.B).toMatchObject({ status: 'active', joinIndex: 1, canAddExpenses: true });
    b.apply('B', 'expense.update', { expenseId: 'e1', baseVersion: 1, data: expense(b.s, { amount: 400, paidBy: ['B'], forWhom: ['B'] }) });
    expect(currentVersion(b.s.expenses.e1!).kind).toBe('edit');
  });
  it('a member removed by an admin needs approval to return, keeping their join order', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('A', 'member.remove', { userId: 'B' });
    expect(b.s.members.B!.status).toBe('removed');
    b.apply('B', 'member.requestJoin', { inviteCode: 'ABCDEFGH' });
    expect(b.s.members.B!.status).toBe('pending');
    b.apply('A', 'member.approve', { userId: 'B' });
    expect(b.s.members.B).toMatchObject({ status: 'active', joinIndex: 1 });
  });
});

describe('roles and admin succession', () => {
  it('admins can promote; the earliest-joined member takes over when the last admin leaves', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('A', 'member.leave', {});
    expect(b.s.members.B!.role).toBe('admin');
    expect(b.s.members.C!.role).toBe('member');
  });
  it('no succession while another admin remains', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('A', 'member.setRole', { userId: 'C', role: 'admin' });
    b.apply('A', 'member.leave', {});
    expect(b.s.members.B!.role).toBe('member');
    expect(b.s.members.C!.role).toBe('admin');
  });
  it('protects the creator and the last admin', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('A', 'member.setRole', { userId: 'B', role: 'admin' });
    expect(b.refuse('B', 'member.setRole', { userId: 'A', role: 'member' })).toBe('forbidden');
    expect(b.refuse('B', 'member.remove', { userId: 'A' })).toBe('forbidden');
    b.apply('B', 'member.setRole', { userId: 'B', role: 'member' });
    expect(b.refuse('A', 'member.setRole', { userId: 'A', role: 'member' })).toBe('last_admin');
    expect(b.refuse('C', 'member.setRole', { userId: 'C', role: 'admin' })).toBe('not_admin');
    expect(b.refuse('A', 'member.remove', { userId: 'A' })).toBe('invalid');
  });
  it('removing a member does not touch their entries', () => {
    const b = groupWith(['A', 'B']);
    b.apply('B', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 1000, paidBy: ['B'], forWhom: ['A', 'B'] }) });
    b.apply('A', 'member.remove', { userId: 'B' });
    expect(netBalances(b.s)).toEqual({ A: -500, B: 500 });
  });
});

describe('permission to add expenses and categories', () => {
  it('members need the add-expense permission; admins always have it', () => {
    const b = groupWith(['A', 'B'], { canAdd: false });
    const data = expense(b.s, { amount: 100, paidBy: ['B'], forWhom: ['B'] });
    expect(b.refuse('B', 'expense.create', { expenseId: 'e1', data })).toBe('no_permission');
    expect(b.refuse('B', 'category.add', { categoryId: 'c1', name: 'Boat' })).toBe('no_permission');
    expect(b.refuse('B', 'member.setPermission', { userId: 'B', canAddExpenses: true })).toBe('not_admin');
    b.apply('A', 'member.setPermission', { userId: 'B', canAddExpenses: true });
    b.apply('B', 'expense.create', { expenseId: 'e1', data });
    b.apply('B', 'category.add', { categoryId: 'c1', name: 'Boat' });
    expect(b.s.categoryOrder.at(-1)).toBe('c1');
  });
  it('category names are unique; only admins rename or hide', () => {
    const b = groupWith(['A', 'B']);
    expect(b.refuse('B', 'category.add', { categoryId: 'c2', name: ' food ' })).toBe('exists');
    expect(b.refuse('B', 'category.update', { categoryId: 'food', hidden: true })).toBe('not_admin');
    b.apply('A', 'category.update', { categoryId: 'food', name: 'Meals' });
    expect(b.s.categories.food).toEqual({ id: 'food', name: 'Meals', hidden: false });
    b.apply('A', 'category.update', { categoryId: 'tips', hidden: true });
    expect(b.s.categories.tips!.hidden).toBe(true);
  });
});

describe('expenses', () => {
  it('validates amounts, people, dates and categories', () => {
    const b = groupWith(['A', 'B']);
    const good = expense(b.s, { amount: 1000, paidBy: ['A'], forWhom: ['A', 'B'] });
    const bad = (patch: object) => b.refuse('A', 'expense.create', { expenseId: 'x', data: { ...good, ...patch } });
    expect(bad({ amount: 0 })).toBe('invalid');
    expect(bad({ amount: 10.5 })).toBe('invalid');
    expect(bad({ amount: 999 })).toBe('unbalanced');
    expect(bad({ categoryId: 'nope' })).toBe('invalid');
    expect(bad({ date: '2026-02-30' })).toBe('invalid');
    expect(bad({ payers: [{ memberId: 'Z', amount: 1000 }], payerSplit: { method: 'equal', members: ['Z'] } })).toBe('bad_participant');
    expect(bad({ payers: [{ memberId: 'A', amount: 500 }, { memberId: 'A', amount: 500 }] })).toBe('invalid');
    expect(bad({ scope: 'mine' })).toBe('invalid');
  });
  it('multiple payers and beneficiaries move balances exactly', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('A', 'expense.create', {
      expenseId: 'e1',
      data: expense(b.s, { amount: 90000, paidBy: { A: 60000, B: 30000 }, forWhom: { method: 'shares', shares: { A: 1, B: 1, C: 1 } } }),
    });
    expect(netBalances(b.s)).toEqual({ A: 30000, B: 0, C: -30000 });
  });
  it('only the creator edits; an admin edit is recorded as an override; history is kept', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('B', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 300, paidBy: ['B'], forWhom: ['A', 'B', 'C'] }) });
    const v2 = expense(b.s, { amount: 600, paidBy: ['B'], forWhom: ['A', 'B', 'C'] });
    expect(b.refuse('C', 'expense.update', { expenseId: 'e1', baseVersion: 1, data: v2 })).toBe('not_owner');
    expect(b.refuse('C', 'expense.delete', { expenseId: 'e1' })).toBe('not_owner');
    b.apply('B', 'expense.update', { expenseId: 'e1', baseVersion: 1, data: v2 });
    b.apply('A', 'expense.update', { expenseId: 'e1', baseVersion: 2, data: expense(b.s, { amount: 900, paidBy: ['B'], forWhom: ['A', 'B', 'C'] }) });
    const e = b.s.expenses.e1!;
    expect(e.versions.map((v) => [v.kind, v.by, v.data?.amount])).toEqual([
      ['create', 'B', 300],
      ['edit', 'B', 600],
      ['override', 'A', 900],
    ]);
  });
  it('delete keeps the entry restorable; restore brings any old version back', () => {
    const b = groupWith(['A', 'B']);
    b.apply('B', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 1000, paidBy: ['B'], forWhom: ['A', 'B'] }) });
    b.apply('B', 'expense.update', { expenseId: 'e1', baseVersion: 1, data: expense(b.s, { amount: 2000, paidBy: ['B'], forWhom: ['A', 'B'] }) });
    b.apply('B', 'expense.delete', { expenseId: 'e1' });
    expect(netBalances(b.s)).toEqual({ A: 0, B: 0 });
    expect(b.refuse('B', 'expense.update', { expenseId: 'e1', baseVersion: 3, data: expense(b.s, { amount: 1, paidBy: ['B'], forWhom: ['B'] }) })).toBe('deleted');
    expect(b.refuse('B', 'expense.delete', { expenseId: 'e1' })).toBe('deleted');
    expect(b.refuse('B', 'expense.restore', { expenseId: 'e1', version: 3 })).toBe('invalid');
    b.apply('A', 'expense.restore', { expenseId: 'e1', version: 1 });
    expect(netBalances(b.s)).toEqual({ A: -500, B: 500 });
    expect(currentVersion(b.s.expenses.e1!)).toMatchObject({ kind: 'restore', version: 4, by: 'A' });
  });
  it('an edit based on an old version is accepted and flagged as concurrent', () => {
    const b = groupWith(['A', 'B']);
    b.apply('B', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 100, paidBy: ['B'], forWhom: ['B'] }) });
    b.apply('A', 'expense.update', { expenseId: 'e1', baseVersion: 1, data: expense(b.s, { amount: 200, paidBy: ['B'], forWhom: ['B'] }) });
    b.apply('B', 'expense.update', { expenseId: 'e1', baseVersion: 1, data: expense(b.s, { amount: 300, paidBy: ['B'], forWhom: ['B'] }) });
    expect(currentVersion(b.s.expenses.e1!)).toMatchObject({ concurrent: true, version: 3 });
  });
  it('people who left can stay in an old expense when it is edited, but cannot be added to new ones', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('A', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 300, paidBy: ['A'], forWhom: ['A', 'C'] }) });
    expect(b.refuse('A', 'member.approveLeave', { userId: 'C' })).toBe('invalid'); // not requested yet
    b.apply('C', 'member.requestLeave', {});
    b.apply('A', 'member.approveLeave', { userId: 'C' });
    b.apply('A', 'expense.update', { expenseId: 'e1', baseVersion: 1, data: expense(b.s, { amount: 400, paidBy: ['A'], forWhom: ['A', 'C'] }) });
    expect(b.refuse('A', 'expense.create', { expenseId: 'e2', data: expense(b.s, { amount: 400, paidBy: ['A'], forWhom: ['A', 'C'] }) })).toBe('bad_participant');
  });
});

describe('group vs personal costs', () => {
  it('auto scope: group when more than half of active members benefit', () => {
    const b = groupWith(['A', 'B', 'C', 'D']);
    expect(expense(b.s, { amount: 100, paidBy: ['A'], forWhom: ['A', 'B', 'C'] }).scope).toBe('group');
    expect(expense(b.s, { amount: 100, paidBy: ['A'], forWhom: ['A', 'B'] }).scope).toBe('personal');
  });
  it('worked example from the spec', () => {
    const b = groupWith(['A', 'B', 'C', 'D']);
    b.apply('A', 'project.setBudget', { total: 5000000, categories: { accommodation: 1000000 } });
    b.apply('A', 'expense.create', {
      expenseId: 'hotel',
      data: expense(b.s, { amount: 1200000, paidBy: { A: 800000, B: 400000 }, forWhom: ['A', 'B', 'C', 'D'], category: 'accommodation' }),
    });
    b.apply('C', 'expense.create', { expenseId: 'gift', data: expense(b.s, { amount: 100000, paidBy: ['C'], forWhom: ['C', 'D'], category: 'shopping' }) });
    expect(b.s.expenses.gift!.versions[0]!.data!.scope).toBe('personal');
    const sumA = summarize(b.s, 'A');
    expect(sumA.net).toEqual({ A: 500000, B: 100000, C: -250000, D: -350000 });
    expect(sumA.groupTotal).toBe(1200000);
    expect(sumA.budgetRemaining).toBe(3800000);
    expect(sumA.categoryBudgets).toEqual([{ categoryId: 'accommodation', budget: 1000000, spent: 1200000 }]);
    expect(sumA.myPersonalTotal).toBe(0);
    expect(summarize(b.s, 'D').myPersonalTotal).toBe(50000);
    expect(sumA.suggestedPayments).toEqual([
      { from: 'D', to: 'A', amount: 350000 },
      { from: 'C', to: 'A', amount: 150000 },
      { from: 'C', to: 'B', amount: 100000 },
    ]);
  });
});

describe('settlements and contributions', () => {
  it('payments count only after the receiver confirms', () => {
    const b = groupWith(['A', 'B']);
    b.apply('A', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 1000, paidBy: ['A'], forWhom: ['A', 'B'] }) });
    b.apply('B', 'settlement.record', { settlementId: 's1', kind: 'payment', from: 'B', parts: [{ to: 'A', amount: 500 }], method: 'bKash', date: '2026-01-03' });
    expect(netBalances(b.s)).toEqual({ A: 500, B: -500 });
    expect(isSettled(b.s, 'B')).toBe(false);
    expect(b.refuse('B', 'settlement.respond', { settlementId: 's1', response: 'confirm' })).toBe('forbidden');
    b.apply('A', 'settlement.respond', { settlementId: 's1', response: 'confirm' });
    expect(netBalances(b.s)).toEqual({ A: 0, B: 0 });
    expect(isSettled(b.s, 'B')).toBe(true);
    expect(b.refuse('A', 'settlement.cancel', { settlementId: 's1' })).toBe('confirmed');
  });
  it('a receiver recording money they got is confirmed immediately; disputes do not count', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('A', 'settlement.record', { settlementId: 's1', kind: 'payment', from: 'B', parts: [{ to: 'A', amount: 300 }], method: 'cash', date: '2026-01-03' });
    expect(b.s.settlements.s1!.parts[0]!.status).toBe('confirmed');
    b.apply('B', 'settlement.record', { settlementId: 's2', kind: 'payment', from: 'B', parts: [{ to: 'C', amount: 200 }], method: 'cash', date: '2026-01-03' });
    b.apply('C', 'settlement.respond', { settlementId: 's2', response: 'dispute', comment: 'not received' });
    expect(netBalances(b.s)).toEqual({ A: -300, B: 300, C: 0 });
    b.apply('B', 'settlement.cancel', { settlementId: 's2' });
    expect(b.s.settlements.s2!.cancelled).toBe(true);
  });
  it('a contribution to several people at once is not a cost and adds to the giver\'s contribution', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('A', 'settlement.record', {
      settlementId: 'c1',
      kind: 'contribution',
      from: 'A',
      parts: [{ to: 'B', amount: 60000 }, { to: 'C', amount: 40000 }],
      method: 'cash',
      date: '2026-01-02',
    });
    b.apply('B', 'settlement.respond', { settlementId: 'c1', response: 'confirm' });
    let sum = summarize(b.s, 'A');
    expect(sum.groupTotal).toBe(0);
    expect(sum.contributions).toEqual({ A: 60000 });
    expect(sum.net).toEqual({ A: 60000, B: -60000, C: 0 });
    b.apply('C', 'settlement.respond', { settlementId: 'c1', response: 'confirm' });
    sum = summarize(b.s, 'A');
    expect(sum.contributions).toEqual({ A: 100000 });
    // B and C then spend the money on the group: balances clear.
    b.apply('B', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 60000, paidBy: ['B'], forWhom: ['A', 'B', 'C'] }) });
    b.apply('C', 'expense.create', { expenseId: 'e2', data: expense(b.s, { amount: 40000, paidBy: ['C'], forWhom: ['A', 'B', 'C'] }) });
    expect(summarize(b.s, 'A').net).toEqual({ A: 66666, B: -33333, C: -33333 });
  });
  it('validates settlements', () => {
    const b = groupWith(['A', 'B', 'C']);
    const rec = (actor: string, patch: object) =>
      b.refuse(actor, 'settlement.record', { settlementId: 's9', kind: 'payment', from: 'B', parts: [{ to: 'A', amount: 100 }], method: 'cash', date: '2026-01-03', ...patch });
    expect(rec('B', { parts: [{ to: 'B', amount: 100 }] })).toBe('invalid');
    expect(rec('B', { parts: [{ to: 'A', amount: 0 }] })).toBe('invalid');
    expect(rec('B', { parts: [{ to: 'Z', amount: 10 }] })).toBe('bad_participant');
    expect(rec('B', { parts: [{ to: 'A', amount: 1 }, { to: 'A', amount: 1 }] })).toBe('invalid');
    expect(rec('C', {})).toBe('forbidden');
    expect(rec('B', { method: ' ' })).toBe('invalid');
  });
});

describe('leaving', () => {
  it('an unsettled member needs admin approval to leave', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('A', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 300, paidBy: ['A'], forWhom: ['A', 'B', 'C'] }) });
    expect(b.refuse('B', 'member.leave', {})).toBe('unsettled');
    b.apply('B', 'member.requestLeave', {});
    expect(b.s.members.B!.leaveRequested).toBe(true);
    expect(b.refuse('C', 'member.approveLeave', { userId: 'B' })).toBe('not_admin');
    b.apply('A', 'member.denyLeave', { userId: 'B' });
    b.apply('B', 'member.requestLeave', {});
    b.apply('A', 'member.approveLeave', { userId: 'B' });
    expect(b.s.members.B!.status).toBe('left');
    // Their debt stays on the books.
    expect(netBalances(b.s).B).toBe(-100);
  });
  it('a settled member leaves freely and cannot request approval', () => {
    const b = groupWith(['A', 'B']);
    expect(b.refuse('B', 'member.requestLeave', {})).toBe('settled');
    b.apply('B', 'member.leave', {});
    expect(b.s.members.B!.status).toBe('left');
  });
  it('an unsettled admin needs another admin to approve', () => {
    const b = groupWith(['A', 'B']);
    b.apply('B', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 200, paidBy: ['B'], forWhom: ['A', 'B'] }) });
    b.apply('A', 'member.requestLeave', {});
    expect(b.refuse('A', 'member.approveLeave', { userId: 'A' })).toBe('forbidden');
    b.apply('A', 'member.setRole', { userId: 'B', role: 'admin' });
    b.apply('B', 'member.approveLeave', { userId: 'A' });
    expect(b.s.members.A!.status).toBe('left');
  });
  it('a pending payment counts as unsettled', () => {
    const b = groupWith(['A', 'B']);
    b.apply('B', 'settlement.record', { settlementId: 's1', kind: 'payment', from: 'B', parts: [{ to: 'A', amount: 100 }], method: 'cash', date: '2026-01-03' });
    expect(b.refuse('A', 'member.leave', {})).toBe('unsettled');
  });
});

describe('archive, trash and auto-archive', () => {
  it('archived and trashed projects are read-only until restored; only admins act', () => {
    const b = groupWith(['A', 'B']);
    expect(b.refuse('B', 'project.archive', {})).toBe('not_admin');
    b.apply('A', 'project.archive', {});
    const data = expense(b.s, { amount: 100, paidBy: ['A'], forWhom: ['A'] });
    expect(b.refuse('A', 'expense.create', { expenseId: 'e1', data })).toBe('read_only');
    expect(b.refuse('B', 'member.updateProfile', { profile: { name: 'x' } })).toBe('read_only');
    expect(b.refuse('A', 'project.archive', {})).toBe('read_only');
    b.apply('A', 'project.trash', {});
    expect(b.refuse('A', 'project.unarchive', {})).toBe('invalid');
    b.apply('A', 'project.restore', {});
    expect(b.s.status).toBe('active');
    b.apply('A', 'expense.create', { expenseId: 'e1', data });
  });
  it('only the server auto-archives, and only after 3 months idle', () => {
    const b = groupWith(['A', 'B']);
    expect(b.refuse('A', 'project.autoArchive', {})).toBe('forbidden');
    b.now += AUTO_ARCHIVE_AFTER_MS - DAY;
    expect(b.refuse('system', 'project.autoArchive', {})).toBe('invalid');
    b.now += DAY;
    b.apply('system', 'project.autoArchive', {});
    expect(b.s.status).toBe('archived');
  });
});

describe('personal projects', () => {
  it('have no members, joining or settlements, and never auto-archive', () => {
    const b = new Book();
    b.apply('A', 'project.create', { type: 'personal', name: 'Daily life', currency: 'BDT' });
    expect(b.refuse('A', 'project.setInviteCode', { code: 'ABCDEFGH' })).toBe('group_only');
    expect(b.refuse('system', 'project.autoArchive', {})).toBe('group_only');
    b.apply('A', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 5000, paidBy: ['A'], forWhom: ['A'] }) });
    expect(summarize(b.s, 'A').groupTotal).toBe(5000);
    expect(b.refuse('A', 'settlement.record', { settlementId: 's', kind: 'payment', from: 'A', parts: [{ to: 'B', amount: 1 }], method: 'x', date: '2026-01-01' })).toBe('group_only');
  });
});

describe('profiles', () => {
  it('all fields optional, trimmed; unknown fields refused', () => {
    const b = groupWith(['A', 'B']);
    b.apply('B', 'member.updateProfile', { profile: { name: ' Bina ', bkash: '01700000000', nid: '', whatsapp: undefined } });
    expect(b.s.members.B!.profile).toEqual({ name: 'Bina', bkash: '01700000000' });
    expect(b.refuse('B', 'member.updateProfile', { profile: { password: 'x' } as never })).toBe('invalid');
  });
});
