import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  currentVersion,
  makeOp,
  netBalances,
  OpError,
  replay,
  type Op,
  type ProjectSync,
  type StoredOp,
} from '../src';
import { DAY, Device, expense, newServer, nextId, T0, type Fault } from './helpers';

const USERS = ['A', 'B', 'C', 'D'] as const;

async function setupGroup() {
  const { authority, store } = newServer();
  const clock = { now: T0 };
  const devices = Object.fromEntries(USERS.map((u) => [u, new Device(u, authority, clock)])) as Record<string, Device>;
  const a = await devices.A!.project('P1');
  // Project is created offline first, then synced.
  devices.A!.transport.online = false;
  await a.submit('project.create', { type: 'group', name: 'Trip', currency: 'BDT', creatorName: 'A' });
  await a.submit('project.setInviteCode', { code: 'TRIPCODE' });
  expect(await a.sync()).toBe('offline');
  expect(a.state?.name).toBe('Trip'); // visible immediately while offline
  devices.A!.transport.online = true;
  expect(await a.sync()).toBe('synced');
  for (const u of ['B', 'C', 'D']) {
    const invite = await authority.lookupInvite('tripcode');
    expect(invite?.projectId).toBe('P1');
    const p = await devices[u]!.project('P1');
    await p.enqueueRaw(makeOp('member.requestJoin', { inviteCode: 'TRIPCODE', name: u }, { id: nextId('op'), projectId: 'P1', actorId: u, at: clock.now }));
    expect(await p.sync()).toBe('pending');
    expect(p.doc.access).toBe('pending');
  }
  await a.sync();
  for (const u of ['B', 'C', 'D']) {
    await a.submit('member.approve', { userId: u });
    await a.submit('member.setPermission', { userId: u, canAddExpenses: true });
  }
  await a.sync();
  for (const u of ['B', 'C', 'D']) {
    const p = await devices[u]!.project('P1');
    expect(await p.sync()).toBe('synced');
    expect(p.doc.pending).toHaveLength(0); // the join request was confirmed and removed from the queue
  }
  return { authority, store, devices, clock };
}

type Cmd =
  | { k: 'expense'; u: number; amount: number; payers: number[]; bens: number[] }
  | { k: 'edit'; u: number; pick: number; amount: number }
  | { k: 'delete'; u: number; pick: number }
  | { k: 'restore'; u: number; pick: number }
  | { k: 'settle'; u: number; to: number; amount: number }
  | { k: 'confirm'; u: number; dispute: boolean }
  | { k: 'profile'; u: number; nid: boolean }
  | { k: 'sync'; u: number; faults: Fault[] }
  | { k: 'net'; u: number; online: boolean }
  | { k: 'restart'; u: number }
  | { k: 'diskfail'; u: number };

const user = fc.integer({ min: 0, max: 3 });
const people = fc.uniqueArray(user, { minLength: 1, maxLength: 4 });
const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ k: fc.constant('expense' as const), u: user, amount: fc.integer({ min: 1, max: 500000 }), payers: people, bens: people }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('edit' as const), u: user, pick: fc.nat(), amount: fc.integer({ min: 1, max: 500000 }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('delete' as const), u: user, pick: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('restore' as const), u: user, pick: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('settle' as const), u: user, to: user, amount: fc.integer({ min: 1, max: 100000 }) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('confirm' as const), u: user, dispute: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('profile' as const), u: user, nid: fc.boolean() }) },
  {
    weight: 5,
    arbitrary: fc.record({
      k: fc.constant('sync' as const),
      u: user,
      faults: fc.array(fc.constantFrom<Fault>('none', 'offline', 'lose_response', 'deliver_twice'), { maxLength: 4 }),
    }),
  },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('net' as const), u: user, online: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('restart' as const), u: user }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('diskfail' as const), u: user }) },
);

async function run(cmds: Cmd[]) {
  const { authority, store, devices, clock } = await setupGroup();
  const queued = new Map<string, string[]>(USERS.map((u) => [u, []]));

  const tryDo = async (u: string, fn: (p: ProjectSync) => Promise<Op>) => {
    const p = await devices[u]!.project('P1');
    try {
      const op = await fn(p);
      queued.get(u)!.push(op.id);
    } catch (e) {
      // Refused locally (not allowed / invalid) or the device failed to save: nothing was queued.
      if (!(e instanceof OpError) && !(e instanceof Error && e.message === 'disk full')) throw e;
    }
  };

  for (const c of cmds) {
    clock.now += 60_000;
    const u = USERS[c.u]!;
    const dev = devices[u]!;
    const p = await dev.project('P1');
    const s = p.state!;
    const mine = s.expenseOrder.filter((id) => s.expenses[id]!.createdBy === u || u === 'A');
    switch (c.k) {
      case 'expense':
        await tryDo(u, (p) =>
          p.submit('expense.create', {
            expenseId: nextId('e'),
            data: expense(s, { amount: c.amount, paidBy: c.payers.map((i) => USERS[i]!), forWhom: c.bens.map((i) => USERS[i]!) }),
          }),
        );
        break;
      case 'edit': {
        const id = mine[c.pick % Math.max(1, mine.length)];
        const cur = id ? currentVersion(s.expenses[id]!) : null;
        if (!id || !cur?.data) break;
        const ids = cur.data.beneficiaries.map((b) => b.memberId);
        await tryDo(u, (p) =>
          p.submit('expense.update', {
            expenseId: id,
            baseVersion: cur.version,
            data: expense(s, { amount: c.amount, paidBy: cur.data!.payers.map((x) => x.memberId), forWhom: ids }),
          }),
        );
        break;
      }
      case 'delete': {
        const id = mine[c.pick % Math.max(1, mine.length)];
        if (id) await tryDo(u, (p) => p.submit('expense.delete', { expenseId: id }));
        break;
      }
      case 'restore': {
        const id = mine[c.pick % Math.max(1, mine.length)];
        if (id) await tryDo(u, (p) => p.submit('expense.restore', { expenseId: id, version: 1 }));
        break;
      }
      case 'settle': {
        const to = USERS[c.to]!;
        if (to === u) break;
        await tryDo(u, (p) =>
          p.submit('settlement.record', { settlementId: nextId('s'), kind: c.amount % 2 ? 'payment' : 'contribution', from: u, parts: [{ to, amount: c.amount }], method: 'cash', date: '2026-01-05' }),
        );
        break;
      }
      case 'confirm': {
        const sid = s.settlementOrder.find((id) => s.settlements[id]!.parts.some((x) => x.to === u && x.status === 'pending'));
        if (sid) await tryDo(u, (p) => p.submit('settlement.respond', { settlementId: sid, response: c.dispute ? 'dispute' : 'confirm' }));
        break;
      }
      case 'profile':
        await tryDo(u, (p) => p.submit('member.updateProfile', { profile: { name: u, nid: c.nid ? `NID-${u}` : undefined } }));
        break;
      case 'sync':
        dev.transport.faults = [...c.faults];
        try {
          await p.sync();
        } catch (e) {
          // The device could not save what it downloaded; it simply re-downloads later.
          if (!(e instanceof Error && e.message === 'disk full')) throw e;
        }
        dev.transport.faults = [];
        break;
      case 'net':
        dev.transport.online = c.online;
        break;
      case 'restart':
        dev.restart();
        break;
      case 'diskfail':
        dev.store.failNextSave = true;
        break;
    }
  }

  // Heal the network and let everyone sync until nothing changes.
  for (const d of Object.values(devices)) {
    d.transport.online = true;
    d.transport.faults = [];
    d.store.failNextSave = false;
  }
  for (let round = 0; round < 3; round++) for (const u of USERS) await (await devices[u]!.project('P1')).sync();

  // ---- Checks ----
  const server = store.projects.get('P1')!;
  const serverIds = server.ops.map((o) => o.id);
  expect(new Set(serverIds).size).toBe(serverIds.length); // no duplicates on the server
  expect(server.ops.map((o) => o.seq)).toEqual(server.ops.map((_, i) => i + 1)); // no gaps
  const serverNet = netBalances(server.state);
  expect(Object.values(serverNet).reduce((a, b) => a + b, 0)).toBe(0);

  for (const u of USERS) {
    const d = devices[u]!;
    d.restart(); // everything must also survive an app restart
    const p = await d.project('P1');
    // Nothing waiting, nothing lost: every queued op is on the server exactly once, or was refused with a reason.
    expect(p.doc.pending).toEqual([]);
    const rejected = new Set(p.doc.rejected.map((r) => r.op.id));
    for (const id of queued.get(u)!) {
      const count = serverIds.filter((x) => x === id).length + (rejected.has(id) ? 1 : 0);
      expect(count, `op ${id} of ${u}`).toBe(1);
    }
    // Device log equals the server log as this user is allowed to see it.
    const pulled = await authority.pull(u, 'P1', 0, 100000);
    if (!pulled.ok) throw new Error('no access');
    expect(p.doc.confirmed).toEqual(pulled.ops);
    expect(p.doc.lastSeq).toBe(server.ops.length);
    // Same balances everywhere, and the device state is exactly the replay of its log.
    expect(netBalances(p.state!)).toEqual(serverNet);
    expect(p.state).toEqual(replay(p.doc.confirmed as StoredOp[]));
    // Privacy: personal expenses are hidden from people not involved, NIDs from non-admins.
    for (const id of p.state!.expenseOrder) {
      const full = currentVersion(server.state.expenses[id]!);
      const seen = currentVersion(p.state!.expenses[id]!);
      if (full.data?.scope === 'personal') {
        const involved = new Set([...full.data.payers, ...full.data.beneficiaries].map((x) => x.memberId));
        const touched = server.state.expenses[id]!.versions.some((v) => v.by === u);
        if (!involved.has(u) && server.state.expenses[id]!.createdBy !== u && !touched) {
          expect(seen.data).toBeNull();
        }
      }
    }
    for (const m of Object.values(p.state!.members)) {
      if (m.userId !== u && u !== 'A') expect(m.profile.nid).toBeUndefined();
    }
  }
}

describe('offline sync', () => {
  it('converges with no duplicates or losses under random faults', async () => {
    await fc.assert(fc.asyncProperty(fc.array(cmd, { minLength: 5, maxLength: 60 }), run), { numRuns: 120 });
  }, 120_000);

  it('a lost response followed by a retry never duplicates an expense', async () => {
    const { devices, store } = await setupGroup();
    const b = await devices.B!.project('P1');
    await b.submit('expense.create', { expenseId: 'e1', data: expense(b.state!, { amount: 1000, paidBy: ['B'], forWhom: ['A', 'B', 'C', 'D'] }) });
    devices.B!.transport.faults = ['lose_response'];
    expect(await b.sync()).toBe('offline');
    expect(b.doc.pending).toHaveLength(1); // still queued: the device does not know it arrived
    devices.B!.restart();
    const b2 = await devices.B!.project('P1');
    expect(await b2.sync()).toBe('synced');
    expect(b2.doc.pending).toHaveLength(0);
    expect(store.projects.get('P1')!.ops.filter((o) => o.type === 'expense.create')).toHaveLength(1);
  });

  it('a change refused by the server is kept in the rejected list with the reason', async () => {
    const { devices } = await setupGroup();
    const a = await devices.A!.project('P1');
    const c = await devices.C!.project('P1');
    // C is offline and adds an expense; meanwhile the admin removes C's permission.
    devices.C!.transport.online = false;
    await c.submit('expense.create', { expenseId: 'e1', data: expense(c.state!, { amount: 500, paidBy: ['C'], forWhom: ['C'] }) });
    await a.submit('member.setPermission', { userId: 'C', canAddExpenses: false });
    await a.sync();
    devices.C!.transport.online = true;
    await c.sync();
    expect(c.doc.pending).toHaveLength(0);
    expect(c.doc.rejected).toHaveLength(1);
    expect(c.doc.rejected[0]!.code).toBe('no_permission');
    expect(c.state!.expenses.e1).toBeUndefined();
  });

  it('a pending change that no longer applies is flagged before syncing', async () => {
    const { devices } = await setupGroup();
    const a = await devices.A!.project('P1');
    const b = await devices.B!.project('P1');
    await b.submit('expense.create', { expenseId: 'e1', data: expense(b.state!, { amount: 500, paidBy: ['B'], forWhom: ['B'] }) });
    await b.sync();
    await a.sync();
    devices.B!.transport.online = false;
    const op = await b.submit('expense.delete', { expenseId: 'e1' });
    await a.submit('expense.delete', { expenseId: 'e1' });
    await a.sync();
    devices.B!.transport.online = true;
    // Pull happens after push, so check the flag by pulling without pushing first:
    devices.B!.transport.faults = [];
    await b.sync();
    expect(b.doc.rejected.map((r) => [r.op.id, r.code])).toEqual([[op.id, 'deleted']]);
  });

  it('saving fails → the change is not queued and the user gets an error', async () => {
    const { devices } = await setupGroup();
    const b = await devices.B!.project('P1');
    devices.B!.store.failNextSave = true;
    await expect(b.submit('member.updateProfile', { profile: { name: 'x' } })).rejects.toThrow('disk full');
    expect(b.doc.pending).toHaveLength(0);
  });

  it('promotion to admin re-downloads the log so hidden details appear', async () => {
    const { devices } = await setupGroup();
    const a = await devices.A!.project('P1');
    const c = await devices.C!.project('P1');
    const d = await devices.D!.project('P1');
    await d.submit('member.updateProfile', { profile: { name: 'Dina', nid: '1234567890' } });
    await d.sync();
    await c.sync();
    expect(c.state!.members.D!.profile).toEqual({ name: 'Dina' });
    await a.sync();
    await a.submit('member.setRole', { userId: 'C', role: 'admin' });
    await a.sync();
    await c.sync();
    expect(c.state!.members.D!.profile).toEqual({ name: 'Dina', nid: '1234567890' });
  });

  it('a removed member loses access; an auto-archived project becomes read-only on every device', async () => {
    const { devices, authority, clock } = await setupGroup();
    const a = await devices.A!.project('P1');
    const d = await devices.D!.project('P1');
    await a.submit('member.remove', { userId: 'D' });
    await a.sync();
    expect(await d.sync()).toBe('no_access');
    clock.now += 91 * DAY;
    expect((await authority.sweep(clock.now)).archived).toEqual(['P1']);
    await a.sync();
    expect(a.state!.status).toBe('archived');
    await expect(a.submit('project.update', { name: 'X' })).rejects.toThrow(OpError);
  });

  it('trash is purged after 30 days and devices learn the project is gone', async () => {
    const { devices, authority, clock } = await setupGroup();
    const a = await devices.A!.project('P1');
    const b = await devices.B!.project('P1');
    await a.submit('project.trash', {});
    await a.sync();
    clock.now += 29 * DAY;
    expect((await authority.sweep(clock.now)).purged).toEqual([]);
    clock.now += DAY;
    expect((await authority.sweep(clock.now)).purged).toEqual(['P1']);
    expect(await b.sync()).toBe('purged');
  });
});
