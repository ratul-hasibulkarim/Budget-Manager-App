import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  activityFeed,
  balanceChangeAudience,
  createBackup,
  emptyDoc,
  expensesCsv,
  makeOp,
  mergeDocs,
  netBalances,
  ProjectSync,
  readBackup,
  replay,
  redactFor,
  reminderMessage,
  settlementSummaryMessage,
  simplifyDebts,
  budgetLevel,
  whatsappLink,
  type StoredOp,
} from '../src';
import { Book, expense, groupWith, MemoryDocStore, newServer, nextId, T0 } from './helpers';

describe('balances', () => {
  it('property: nets always add up to zero and suggested payments clear everyone', () => {
    const ids = ['A', 'B', 'C', 'D', 'E'];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amount: fc.integer({ min: 1, max: 10_000_000 }),
            payers: fc.uniqueArray(fc.constantFrom(...ids), { minLength: 1, maxLength: 5 }),
            bens: fc.uniqueArray(fc.constantFrom(...ids), { minLength: 1, maxLength: 5 }),
          }),
          { maxLength: 30 },
        ),
        (list) => {
          const b = groupWith(ids);
          list.forEach((e, i) => b.apply('A', 'expense.create', { expenseId: `e${i}`, data: expense(b.s, { amount: e.amount, paidBy: e.payers, forWhom: e.bens }) }));
          const net = netBalances(b.s);
          expect(Object.values(net).reduce((a, v) => a + v, 0)).toBe(0);
          const transfers = simplifyDebts(net, ids);
          expect(transfers.length).toBeLessThanOrEqual(Math.max(0, ids.length - 1));
          const after = { ...net };
          for (const t of transfers) {
            expect(t.amount).toBeGreaterThan(0);
            after[t.from]! += t.amount;
            after[t.to]! -= t.amount;
          }
          expect(Object.values(after).every((v) => v === 0)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
  it('budget alerts at 80% and 100% with exact comparison', () => {
    expect(budgetLevel(79, 100)).toBe('ok');
    expect(budgetLevel(80, 100)).toBe('near');
    expect(budgetLevel(100, 100)).toBe('over');
    expect(budgetLevel(150, 100)).toBe('over'); // can be exceeded, only a warning
    expect(budgetLevel(100, null)).toBe('ok');
  });
});

describe('privacy', () => {
  it('uninvolved members get only the balance effect of a personal expense', () => {
    const b = groupWith(['A', 'B', 'C', 'D']);
    b.apply('C', 'expense.create', { expenseId: 'g', data: expense(b.s, { amount: 1000, paidBy: ['C'], forWhom: ['C', 'D'], description: 'Gift' }) });
    const op = b.log.at(-1)!;
    expect(redactFor(op, 'D', b.s)).toBe(op);
    const forA = redactFor(op, 'A', b.s);
    expect(forA.payload).toEqual({ expenseId: 'g', hidden: { effect: { C: 500, D: -500 } } });
    expect(JSON.stringify(forA)).not.toContain('Gift');
  });
  it('group expenses are visible to all', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('B', 'expense.create', { expenseId: 'g', data: expense(b.s, { amount: 900, paidBy: ['B'], forWhom: ['A', 'B', 'C'] }) });
    const op = b.log.at(-1)!;
    expect(redactFor(op, 'C', b.s)).toBe(op);
  });
  it('NID only for self and admins', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('B', 'member.updateProfile', { profile: { name: 'B', nid: '123' } });
    const op = b.log.at(-1)!;
    expect(redactFor(op, 'B', b.s)).toBe(op);
    expect(redactFor(op, 'A', b.s)).toBe(op);
    expect(redactFor(op, 'C', b.s).payload).toEqual({ profile: { name: 'B' } });
  });
});

describe('server authority', () => {
  async function created() {
    const { authority, store } = newServer();
    const create = makeOp('project.create', { type: 'group', name: 'T', currency: 'BDT' }, { id: nextId('op'), projectId: 'P1', actorId: 'A', at: T0 });
    await authority.push('A', 'P1', [create], T0);
    return { authority, store };
  }
  it('refuses ops signed as someone else, and client-sent auto-archive', async () => {
    const { authority } = await created();
    const fake = makeOp('project.update', { name: 'X' }, { id: nextId('op'), projectId: 'P1', actorId: 'A', at: T0 });
    expect((await authority.push('B', 'P1', [fake], T0))[0]).toMatchObject({ status: 'rejected', code: 'forbidden' });
    const auto = makeOp('project.autoArchive', {}, { id: nextId('op'), projectId: 'P1', actorId: 'A', at: T0 });
    expect((await authority.push('A', 'P1', [auto], T0))[0]).toMatchObject({ status: 'rejected', code: 'forbidden' });
  });
  it('a refused op gets the same answer on retry, even if it would now be allowed', async () => {
    const { authority } = await created();
    const op = makeOp('member.requestJoin', { inviteCode: 'ABCDEFGH' }, { id: nextId('op'), projectId: 'P1', actorId: 'B', at: T0 });
    expect((await authority.push('B', 'P1', [op], T0))[0]).toMatchObject({ status: 'rejected', code: 'bad_invite' });
    await authority.push('A', 'P1', [makeOp('project.setInviteCode', { code: 'ABCDEFGH' }, { id: nextId('op'), projectId: 'P1', actorId: 'A', at: T0 })], T0);
    expect((await authority.push('B', 'P1', [op], T0))[0]).toMatchObject({ status: 'rejected', code: 'bad_invite' });
  });
  it('invite codes are unique across projects; lookups ignore case and archived projects', async () => {
    const { authority } = await created();
    await authority.push('A', 'P1', [makeOp('project.setInviteCode', { code: 'SAMECODE' }, { id: nextId('op'), projectId: 'P1', actorId: 'A', at: T0 })], T0);
    await authority.push('X', 'P2', [makeOp('project.create', { type: 'group', name: 'T2', currency: 'BDT' }, { id: nextId('op'), projectId: 'P2', actorId: 'X', at: T0 })], T0);
    const r = await authority.push('X', 'P2', [makeOp('project.setInviteCode', { code: 'SAMECODE' }, { id: nextId('op'), projectId: 'P2', actorId: 'X', at: T0 })], T0);
    expect(r[0]).toMatchObject({ status: 'rejected', code: 'invite_taken' });
    expect(await authority.lookupInvite(' samecode ')).toMatchObject({ projectId: 'P1', name: 'T', memberCount: 1 });
    await authority.push('A', 'P1', [makeOp('project.archive', {}, { id: nextId('op'), projectId: 'P1', actorId: 'A', at: T0 })], T0);
    expect(await authority.lookupInvite('SAMECODE')).toBeNull();
  });
  it('an op id can never be reused for another project', async () => {
    const { authority } = await created();
    const op = makeOp('project.create', { type: 'group', name: 'T2', currency: 'BDT' }, { id: nextId('op'), projectId: 'P2', actorId: 'A', at: T0 });
    await authority.push('A', 'P2', [op], T0);
    const again = { ...op, projectId: 'P3' };
    expect((await authority.push('A', 'P3', [again], T0))[0]).toMatchObject({ status: 'rejected' });
  });
  it('lists my projects and hides content from non-members', async () => {
    const { authority } = await created();
    expect(await authority.listProjects('A')).toMatchObject([{ projectId: 'P1', myStatus: 'active', type: 'group' }]);
    expect(await authority.pull('B', 'P1', 0)).toEqual({ ok: false, reason: 'no_access' });
    expect(await authority.pull('B', 'NOPE', 0)).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('client engine edge cases', () => {
  it('refuses a page with a gap instead of applying it', async () => {
    const b = groupWith(['A']);
    const ops = b.log as StoredOp[];
    const store = new MemoryDocStore();
    const sync = new ProjectSync(emptyDoc('P1'), {
      store,
      userId: 'A',
      newId: () => nextId('op'),
      now: () => T0,
      transport: {
        push: async () => [],
        pull: async () => ({ ok: true, ops: [{ ...ops[0]!, seq: 2 }], head: 2 }),
      },
    });
    expect(await sync.sync()).toBe('offline');
    expect(sync.doc.lastSeq).toBe(0);
    expect(sync.state).toBeNull();
  });
  it('local validation stops invalid changes before they are queued', async () => {
    const b = new Book();
    b.apply('A', 'project.create', { type: 'group', name: 'T', currency: 'BDT' });
    const sync = new ProjectSync(
      { ...emptyDoc('P1'), confirmed: b.log, lastSeq: 1 },
      { store: new MemoryDocStore(), userId: 'A', newId: () => nextId('op'), now: () => T0, transport: { push: async () => [], pull: async () => ({ ok: true, ops: [], head: 1 }) } },
    );
    await expect(sync.submit('member.remove', { userId: 'A' })).rejects.toMatchObject({ code: 'invalid' });
    expect(sync.doc.pending).toHaveLength(0);
  });
});

describe('backup', () => {
  it('round-trips and detects damage', () => {
    const doc = { ...emptyDoc('P1'), lastSeq: 1, confirmed: groupWith(['A']).log };
    const text = createBackup('A', [doc], T0);
    expect(readBackup(text).projects[0]).toEqual(doc);
    expect(() => readBackup(text.replace('"Trip"', '"Trap"'))).toThrow('damaged');
    expect(() => readBackup('{}')).toThrow('Not a backup');
    expect(() => readBackup('nope')).toThrow('Not a backup');
  });
  it('merging a restore never duplicates or drops changes', () => {
    const log = groupWith(['A', 'B']).log;
    const p1 = makeOp('member.updateProfile', { profile: { name: 'x' } }, { id: 'pend1aaaa', projectId: 'P1', actorId: 'A', at: T0 });
    const p2 = makeOp('member.updateProfile', { profile: { name: 'y' } }, { id: 'pend2aaaa', projectId: 'P1', actorId: 'A', at: T0 });
    const local = { ...emptyDoc('P1'), confirmed: log.slice(0, 2), lastSeq: 2, pending: [p1] };
    const restored = { ...emptyDoc('P1'), confirmed: log, lastSeq: log.length, pending: [p1, p2] };
    const merged = mergeDocs(local, restored);
    expect(merged.lastSeq).toBe(log.length);
    expect(merged.pending.map((o) => o.id)).toEqual(['pend1aaaa', 'pend2aaaa']);
    expect(mergeDocs(null, restored)).toBe(restored);
  });
});

describe('activity, messages and export', () => {
  it('feed shows money changes only, never joins/approvals, and hides personal expenses of others', () => {
    const b = groupWith(['A', 'B', 'C']);
    b.apply('A', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 900, paidBy: ['A'], forWhom: ['A', 'B', 'C'], description: 'Dinner' }) });
    b.apply('B', 'expense.create', { expenseId: 'e2', data: expense(b.s, { amount: 100, paidBy: ['B'], forWhom: ['B'], description: 'Snack' }) });
    b.apply('A', 'expense.delete', { expenseId: 'e1' });
    b.apply('B', 'settlement.record', { settlementId: 's1', kind: 'payment', from: 'B', parts: [{ to: 'A', amount: 300 }], method: 'cash', date: '2026-01-02' });
    // Build what C sees.
    const forC = b.log.map((op) => redactFor(op, 'C', b.s));
    const feed = activityFeed(forC, replay(forC)!);
    expect(feed.map((i) => i.kind === 'expense' ? `${i.action}:${i.description}` : `${i.kind}:${i.action}`)).toEqual([
      'settlement:record',
      'delete:Dinner',
      'create:Dinner',
    ]);
  });
  it('balance-change audience: creator, admins and affected members', () => {
    const b = groupWith(['A', 'B', 'C', 'D']);
    b.apply('C', 'expense.create', { expenseId: 'e1', data: expense(b.s, { amount: 400, paidBy: ['C'], forWhom: ['B', 'C'] }) });
    expect(balanceChangeAudience(b.s, 'e1', { C: 200, B: -200 }, {}).sort()).toEqual(['A', 'B', 'C']);
    expect(balanceChangeAudience(b.s, 'e1', { C: 200 }, { C: 200 })).toEqual([]);
  });
  it('WhatsApp messages in English and Bangla', () => {
    const b = groupWith(['Rafi', 'Sara']);
    b.apply('Rafi', 'project.update', { name: "Cox's Bazar" });
    expect(reminderMessage(b.s, { from: 'Rafi', to: 'Sara', amount: 120000 }, 'en')).toBe(`Rafi, you owe Sara ৳1,200 for "Cox's Bazar".`);
    expect(reminderMessage(b.s, { from: 'Rafi', to: 'Sara', amount: 120000 }, 'bn')).toContain('৳১,২০০');
    expect(settlementSummaryMessage(b.s, [], 'en')).toContain('settled');
    expect(whatsappLink('hi there', '+880 1700-000000')).toBe('https://wa.me/8801700000000?text=hi%20there');
  });
  it('CSV export escapes text and excludes deleted entries', () => {
    const b = groupWith(['A', 'B']);
    b.apply('A', 'expense.create', { expenseId: 'e1', data: { ...expense(b.s, { amount: 1050, paidBy: ['A'], forWhom: ['A', 'B'], description: 'Tea, "special"' }), note: 'line1\nline2' } });
    b.apply('A', 'expense.create', { expenseId: 'e2', data: expense(b.s, { amount: 10, paidBy: ['A'], forWhom: ['A'] }) });
    b.apply('A', 'expense.delete', { expenseId: 'e2' });
    const csv = expensesCsv(b.s);
    expect(csv.split('\n')[1]).toBe('2026-01-02,"Tea, ""special""",Food,10.50,group,A (10.50),A (5.25); B (5.25),"line1');
    expect(csv).not.toContain('0.10');
  });
});
