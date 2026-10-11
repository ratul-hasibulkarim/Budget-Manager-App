import {
  applyOp,
  Authority,
  autoScope,
  cloneState,
  equalSplit,
  joinOrder,
  makeOp,
  MemoryAuthorityStore,
  ProjectSync,
  resolveSplit,
  type DocStore,
  type ExpenseData,
  type Op,
  type OpPayloads,
  type OpType,
  type ProjectDoc,
  type ProjectState,
  type SplitSpec,
  type StoredOp,
  type Transport,
} from '../src';

export const T0 = Date.UTC(2026, 0, 1);
export const DAY = 24 * 60 * 60 * 1000;

let counter = 0;
export function nextId(prefix = 'id') {
  counter++;
  return `${prefix}${String(counter).padStart(10, '0')}`;
}

/** Local (single-process) project for testing rules: applies ops directly like the server would. */
export class Book {
  state: ProjectState | null = null;
  seq = 0;
  now = T0;
  log: StoredOp[] = [];

  apply<T extends OpType>(actorId: string, type: T, payload: OpPayloads[T], projectId = 'P1'): ProjectState {
    const op = { ...makeOp(type, payload, { id: nextId('op'), projectId, actorId, at: this.now }), seq: this.seq + 1, serverAt: this.now } as StoredOp;
    const next = applyOp(this.state ? cloneState(this.state) : null, op, { seq: op.seq, serverAt: this.now });
    this.state = next;
    this.seq++;
    this.log.push(op);
    return next;
  }

  /** Expects the op to be refused with the given code, and state to be unchanged. */
  refuse<T extends OpType>(actorId: string, type: T, payload: OpPayloads[T]): string {
    const before = JSON.stringify(this.state);
    const op = { ...makeOp(type, payload, { id: nextId('op'), projectId: 'P1', actorId, at: this.now }), seq: this.seq + 1, serverAt: this.now } as StoredOp;
    try {
      applyOp(this.state, op, { seq: op.seq, serverAt: this.now });
    } catch (e) {
      if (JSON.stringify(this.state) !== before) throw new Error(`State changed by refused op ${type}`);
      return (e as { code?: string }).code ?? 'unknown';
    }
    throw new Error(`Expected ${type} by ${actorId} to be refused`);
  }

  get s(): ProjectState {
    if (!this.state) throw new Error('no state');
    return this.state;
  }
}

/** Creates a group project P1 with creator A and approved members. */
export function groupWith(members: string[], opts: { canAdd?: boolean } = {}): Book {
  const b = new Book();
  const [creator, ...rest] = members;
  b.apply(creator!, 'project.create', { type: 'group', name: 'Trip', currency: 'BDT', creatorName: creator });
  if (rest.length) {
    b.apply(creator!, 'project.setInviteCode', { code: 'ABCDEFGH' });
    for (const m of rest) {
      b.apply(m, 'member.requestJoin', { inviteCode: 'ABCDEFGH', name: m });
      b.apply(creator!, 'member.approve', { userId: m });
      if (opts.canAdd !== false) b.apply(creator!, 'member.setPermission', { userId: m, canAddExpenses: true });
    }
  }
  return b;
}

export interface ExpenseInput {
  amount: number;
  /** Payer ids (equal split) or exact amounts. */
  paidBy: string[] | Record<string, number>;
  /** Beneficiary ids (equal split) or a full spec. */
  forWhom: string[] | SplitSpec;
  category?: string;
  date?: string;
  description?: string;
  scope?: 'group' | 'personal';
}

export function expense(state: ProjectState, input: ExpenseInput): ExpenseData {
  const order = joinOrder(state);
  const payerSplit: SplitSpec = Array.isArray(input.paidBy) ? equalSplit(input.paidBy) : { method: 'exact', amounts: input.paidBy };
  const beneficiarySplit: SplitSpec = Array.isArray(input.forWhom) ? equalSplit(input.forWhom) : input.forWhom;
  const beneficiaries = resolveSplit(input.amount, beneficiarySplit, order);
  return {
    amount: input.amount,
    categoryId: input.category ?? 'food',
    date: input.date ?? '2026-01-02',
    description: input.description,
    payerSplit,
    beneficiarySplit,
    payers: resolveSplit(input.amount, payerSplit, order),
    beneficiaries,
    scope: input.scope ?? autoScope(state, beneficiaries.map((b) => b.memberId)),
    scopeSource: input.scope ? 'manual' : 'auto',
  };
}

// ----- Sync simulation -----------------------------------------------------------------------

/** Device storage that serializes on save, like a real database. */
export class MemoryDocStore implements DocStore {
  data = new Map<string, string>();
  saves = 0;
  failNextSave = false;
  async load(projectId: string) {
    const raw = this.data.get(projectId);
    return raw ? (JSON.parse(raw) as ProjectDoc) : null;
  }
  async save(doc: ProjectDoc) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('disk full');
    }
    this.saves++;
    this.data.set(doc.projectId, JSON.stringify(doc));
  }
  async list() {
    return [...this.data.keys()];
  }
  async remove(projectId: string) {
    this.data.delete(projectId);
  }
}

export type Fault = 'none' | 'offline' | 'lose_response' | 'deliver_twice';

/** Network between a device and the server, with injectable faults. */
export class FlakyTransport implements Transport {
  faults: Fault[] = [];
  online = true;
  constructor(
    private authority: Authority,
    private userId: string,
    private clock: { now: number },
  ) {}
  private nextFault(): Fault {
    if (!this.online) return 'offline';
    return this.faults.shift() ?? 'none';
  }
  async push(projectId: string, ops: Op[]) {
    const fault = this.nextFault();
    if (fault === 'offline') throw new Error('network down');
    const body = JSON.parse(JSON.stringify(ops)) as Op[];
    const res = await this.authority.push(this.userId, projectId, body, this.clock.now);
    if (fault === 'deliver_twice') await this.authority.push(this.userId, projectId, body, this.clock.now);
    if (fault === 'lose_response') throw new Error('timeout');
    return res;
  }
  async pull(projectId: string, afterSeq: number) {
    const fault = this.nextFault();
    if (fault === 'offline') throw new Error('network down');
    const res = await this.authority.pull(this.userId, projectId, afterSeq, 7); // small pages to exercise paging
    if (fault === 'lose_response') throw new Error('timeout');
    return JSON.parse(JSON.stringify(res));
  }
}

export class Device {
  store = new MemoryDocStore();
  transport: FlakyTransport;
  syncs = new Map<string, ProjectSync>();
  constructor(
    public userId: string,
    public authority: Authority,
    public clock: { now: number },
  ) {
    this.transport = new FlakyTransport(authority, userId, clock);
  }
  deps() {
    return { store: this.store, transport: this.transport, userId: this.userId, newId: () => nextId('op'), now: () => this.clock.now };
  }
  async project(projectId: string): Promise<ProjectSync> {
    let s = this.syncs.get(projectId);
    if (!s) {
      s = await ProjectSync.open(projectId, this.deps());
      this.syncs.set(projectId, s);
    }
    return s;
  }
  /** Simulates the app being killed: in-memory state is gone, only the device store survives. */
  restart() {
    this.syncs.clear();
  }
}

export function newServer() {
  const store = new MemoryAuthorityStore();
  return { store, authority: new Authority(store) };
}
