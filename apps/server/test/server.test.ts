import { describe, expect, it } from 'vitest';
import {
  ApiClient,
  Authority,
  equalSplit,
  joinOrder,
  makeOp,
  netBalances,
  newId,
  ProjectSync,
  resolveSplit,
  type DocStore,
  type ProjectDoc,
  type ProjectState,
} from '@bm/core';
import { createApp } from '../src/app';
import { Auth } from '../src/auth';
import { SqliteStore } from '../src/sqlite-store';

const SECRET = 'test-secret-test-secret-test-secret!!';

function server() {
  const store = new SqliteStore(':memory:');
  const authority = new Authority(store);
  let clock = Date.UTC(2026, 0, 1);
  const app = createApp({ authority, auth: new Auth(SECRET), now: () => clock });
  let online = true;
  const fetchFn = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    if (!online) throw new Error('network down');
    return app.request(url, init);
  };
  return {
    app,
    store,
    authority,
    fetchFn,
    setOnline: (v: boolean) => (online = v),
    tick: (ms: number) => (clock += ms),
  };
}

class MemStore implements DocStore {
  m = new Map<string, string>();
  async load(id: string) {
    const r = this.m.get(id);
    return r ? (JSON.parse(r) as ProjectDoc) : null;
  }
  async save(doc: ProjectDoc) {
    this.m.set(doc.projectId, JSON.stringify(doc));
  }
  async list() {
    return [...this.m.keys()];
  }
  async remove(id: string) {
    this.m.delete(id);
  }
}

async function device(s: ReturnType<typeof server>) {
  const api = new ApiClient('http://test', null, s.fetchFn);
  const { userId, token } = await api.registerDevice();
  api.token = token;
  const store = new MemStore();
  const open = (projectId: string) =>
    ProjectSync.open(projectId, { store, transport: api, userId, newId, now: () => Date.now() });
  return { api, userId, open };
}

function exp(state: ProjectState, amount: number, payer: string, forWhom: string[]) {
  const order = joinOrder(state);
  return {
    amount,
    categoryId: 'food',
    date: '2026-01-02',
    payerSplit: equalSplit([payer]),
    beneficiarySplit: equalSplit(forWhom),
    payers: resolveSplit(amount, equalSplit([payer]), order),
    beneficiaries: resolveSplit(amount, equalSplit(forWhom), order),
    scope: 'group' as const,
    scopeSource: 'auto' as const,
  };
}

describe('auth', () => {
  it('issues tokens and rejects forged or missing ones', async () => {
    const s = server();
    const res = await s.app.request('/v1/auth/device', { method: 'POST' });
    const { userId, token } = (await res.json()) as { userId: string; token: string };
    expect(userId).toMatch(/^u/);
    expect((await s.app.request('/v1/projects', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
    expect((await s.app.request('/v1/projects')).status).toBe(401);
    const forged = `${userId}.AAAA${token.slice(token.indexOf('.') + 5)}`;
    expect((await s.app.request('/v1/projects', { headers: { Authorization: `Bearer ${forged}` } })).status).toBe(401);
    expect((await s.app.request('/v1/projects', { headers: { Authorization: `Bearer uotheruserxxxxxx.${token.split('.')[1]}` } })).status).toBe(401);
    expect(() => new Auth('short')).toThrow();
  });
  it('validates request bodies', async () => {
    const s = server();
    const d = await device(s);
    const bad = await s.app.request('/v1/projects/P1/ops', { method: 'POST', headers: { Authorization: `Bearer ${d.api.token}`, 'Content-Type': 'application/json' }, body: '{"ops": 5}' });
    expect(bad.status).toBe(400);
    const badAfter = await s.app.request('/v1/projects/P1/ops?after=-1', { headers: { Authorization: `Bearer ${d.api.token}` } });
    expect(badAfter.status).toBe(400);
  });
});

describe('end-to-end over HTTP with SQLite', () => {
  it('group flow: create offline, invite, approve, add expenses offline, settle, everything converges', async () => {
    const s = server();
    const a = await device(s);
    const b = await device(s);
    const pid = newId();

    // A creates the project with no network.
    s.setOnline(false);
    const pa = await a.open(pid);
    await pa.submit('project.create', { type: 'group', name: 'Sylhet', currency: 'BDT', creatorName: 'Arif' });
    await pa.submit('project.setInviteCode', { code: 'SYLHET26' });
    expect(await pa.sync()).toBe('offline');
    s.setOnline(true);
    expect(await pa.sync()).toBe('synced');

    // B joins with the code and waits for approval.
    const invite = await b.api.lookupInvite('sylhet26');
    expect(invite).toMatchObject({ projectId: pid, name: 'Sylhet', memberCount: 1 });
    expect(await b.api.lookupInvite('NOPE1234')).toBeNull();
    const pb = await b.open(pid);
    await pb.enqueueRaw(makeOp('member.requestJoin', { inviteCode: 'SYLHET26', name: 'Bina' }, { id: newId(), projectId: pid, actorId: b.userId, at: Date.now() }));
    expect(await pb.sync()).toBe('pending');
    expect(await b.api.membership(pid)).toMatchObject({ name: 'Sylhet', myStatus: 'pending' });

    await pa.sync();
    await pa.submit('member.approve', { userId: b.userId });
    await pa.submit('member.setPermission', { userId: b.userId, canAddExpenses: true });
    await pa.sync();
    expect(await pb.sync()).toBe('synced');
    expect(pb.state!.members[b.userId]!.status).toBe('active');

    // Both add expenses while offline, then sync in either order.
    s.setOnline(false);
    await pa.submit('expense.create', { expenseId: newId(), data: exp(pa.state!, 300000, a.userId, [a.userId, b.userId]) });
    await pb.submit('expense.create', { expenseId: newId(), data: exp(pb.state!, 100000, b.userId, [a.userId, b.userId]) });
    s.setOnline(true);
    await pb.sync();
    await pa.sync();
    await pb.sync();
    expect(netBalances(pa.state!)).toEqual({ [a.userId]: 100000, [b.userId]: -100000 });
    expect(netBalances(pb.state!)).toEqual(netBalances(pa.state!));

    // B pays A and A confirms.
    await pb.submit('settlement.record', { settlementId: newId(), kind: 'payment', from: b.userId, parts: [{ to: a.userId, amount: 100000 }], method: 'bKash', date: '2026-01-03' });
    await pb.sync();
    await pa.sync();
    const sid = pa.state!.settlementOrder[0]!;
    await pa.submit('settlement.respond', { settlementId: sid, response: 'confirm' });
    await pa.sync();
    await pb.sync();
    expect(netBalances(pb.state!)).toEqual({ [a.userId]: 0, [b.userId]: 0 });

    // The server data survives in SQLite and lists projects per user.
    expect(await b.api.listProjects()).toMatchObject([{ projectId: pid, name: 'Sylhet', myStatus: 'active' }]);
    const loaded = await s.store.getProject(pid);
    expect(loaded!.head).toBe(pa.doc.lastSeq);
  });

  it('SQLite store behaves exactly like the reference store for duplicates and rejections', async () => {
    const s = server();
    const a = await device(s);
    const pid = newId();
    const create = makeOp('project.create', { type: 'group', name: 'X', currency: 'BDT' }, { id: newId(), projectId: pid, actorId: a.userId, at: 0 });
    const r1 = await a.api.push(pid, [create, create]);
    expect(r1.map((r) => r.status)).toEqual(['accepted', 'duplicate']);
    const bad = makeOp('member.remove', { userId: 'nobody' }, { id: newId(), projectId: pid, actorId: a.userId, at: 0 });
    expect((await a.api.push(pid, [bad]))[0]).toMatchObject({ status: 'rejected', code: 'no_such_member' });
    expect((await a.api.push(pid, [bad]))[0]).toMatchObject({ status: 'rejected', code: 'no_such_member' });
    const pulled = await a.api.pull(pid, 0);
    expect(pulled.ok && pulled.ops.length).toBe(1);
  });

  it('auto-archives idle group projects and purges old trash', async () => {
    const s = server();
    const a = await device(s);
    const p1 = newId();
    const p2 = newId();
    await a.api.push(p1, [makeOp('project.create', { type: 'group', name: 'Old', currency: 'BDT' }, { id: newId(), projectId: p1, actorId: a.userId, at: 0 })]);
    await a.api.push(p2, [makeOp('project.create', { type: 'group', name: 'Bin', currency: 'BDT' }, { id: newId(), projectId: p2, actorId: a.userId, at: 0 })]);
    await a.api.push(p2, [makeOp('project.trash', {}, { id: newId(), projectId: p2, actorId: a.userId, at: 0 })]);
    const now = Date.UTC(2026, 0, 1) + 91 * 24 * 3600 * 1000;
    const result = await s.authority.sweep(now);
    expect(result).toEqual({ archived: [p1], purged: [p2] });
    expect((await a.api.listProjects()).map((p) => [p.name, p.status])).toEqual([['Old', 'archived']]);
  });
});
