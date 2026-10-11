import type { PullResult, PushResult } from './authority';
import type { ProjectState, Role } from './model';
import { makeOp, type Op, type OpPayloads, type OpType, type StoredOp } from './ops';
import { applyOp, cloneState, OpError } from './reducer';

/**
 * Client side of sync, one instance per project.
 *
 * Guarantees:
 *  - Nothing is lost: every change is written to the device's store (pending queue) before the
 *    UI is told it succeeded, and stays there until the server's log contains it.
 *  - Nothing is duplicated: each op has a unique id; the server records it once no matter how
 *    many times it is sent, and the client drops it from the queue only when it sees that id
 *    in the server log.
 *  - Every device converges: the confirmed state is always the server's ops applied in server
 *    order, with no gaps (the client refuses non-contiguous pages).
 */

export interface RejectedOp {
  op: Op;
  code: string;
  message: string;
}

export type Access = 'ok' | 'pending' | 'no_access' | 'purged';

export interface ProjectDoc {
  projectId: string;
  /** Server-confirmed ops in order: seq 1..lastSeq. */
  confirmed: StoredOp[];
  /** Local changes not yet seen in the server log, in the order they were made. */
  pending: Op[];
  /** Changes the server refused, kept so the user can see what happened. */
  rejected: RejectedOp[];
  lastSeq: number;
  access: Access;
  /** Viewer's role when last synced; becoming admin triggers a full re-download (admins see more). */
  role: Role | null;
  /** Name shown while waiting for join approval. */
  placeholderName?: string;
}

export interface DocStore {
  load(projectId: string): Promise<ProjectDoc | null>;
  /** Must write the whole document atomically. */
  save(doc: ProjectDoc): Promise<void>;
  list(): Promise<string[]>;
  remove(projectId: string): Promise<void>;
}

export interface Transport {
  push(projectId: string, ops: Op[]): Promise<PushResult[]>;
  pull(projectId: string, afterSeq: number): Promise<PullResult>;
}

export interface EngineDeps {
  store: DocStore;
  transport: Transport;
  userId: string;
  newId: () => string;
  now: () => number;
}

export type SyncOutcome = 'synced' | 'offline' | 'pending' | 'no_access' | 'purged';

export function emptyDoc(projectId: string): ProjectDoc {
  return { projectId, confirmed: [], pending: [], rejected: [], lastSeq: 0, access: 'ok', role: null };
}

export class ProjectSync {
  private confirmedState: ProjectState | null = null;
  private viewCache: { state: ProjectState | null; failing: Map<string, OpError> } | null = null;
  private syncing: Promise<SyncOutcome> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    public doc: ProjectDoc,
    private readonly deps: EngineDeps,
  ) {
    this.confirmedState = this.replayConfirmed();
  }

  static async open(projectId: string, deps: EngineDeps): Promise<ProjectSync> {
    return new ProjectSync((await deps.store.load(projectId)) ?? emptyDoc(projectId), deps);
  }

  get projectId() {
    return this.doc.projectId;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    this.viewCache = null;
    for (const fn of this.listeners) fn();
  }

  private replayConfirmed(): ProjectState | null {
    let s: ProjectState | null = null;
    for (const op of this.doc.confirmed) s = applyOp(s, op, { seq: op.seq, serverAt: op.serverAt });
    return s;
  }

  /** State including local changes that are not yet confirmed (what the user sees). */
  get state(): ProjectState | null {
    return this.view().state;
  }

  /** Server-confirmed state only. */
  get confirmed(): ProjectState | null {
    return this.confirmedState;
  }

  /** Pending ops that no longer apply on top of the latest server state (the server will likely refuse them). */
  get failingPending(): Map<string, OpError> {
    return this.view().failing;
  }

  isPending(opId: string): boolean {
    return this.doc.pending.some((o) => o.id === opId);
  }

  private view() {
    if (this.viewCache) return this.viewCache;
    let state = this.confirmedState ? cloneState(this.confirmedState) : null;
    const failing = new Map<string, OpError>();
    let seq = this.doc.lastSeq;
    for (const op of this.doc.pending) {
      try {
        // applyOp validates before mutating, so a failing op leaves `state` unchanged.
        state = applyOp(state, op, { seq: ++seq, serverAt: op.at });
      } catch (e) {
        failing.set(op.id, e instanceof OpError ? e : new OpError('invalid', String(e)));
      }
    }
    this.viewCache = { state, failing };
    return this.viewCache;
  }

  /**
   * Makes a change. Validates it against what the user currently sees (throws OpError with a
   * reason if not allowed), saves it to the device, and returns the op. Works offline.
   */
  async submit<T extends OpType>(type: T, payload: OpPayloads[T]): Promise<Op<T>> {
    if (this.doc.access === 'purged') throw new OpError('not_found', 'This project was deleted');
    const op = makeOp(type, payload, {
      id: this.deps.newId(),
      projectId: this.doc.projectId,
      actorId: this.deps.userId,
      at: this.deps.now(),
    }) as unknown as Op;
    // Validate on a copy first; throws without queuing anything.
    const current = this.state;
    applyOp(current ? cloneState(current) : null, op, { seq: this.doc.lastSeq + this.doc.pending.length + 1, serverAt: op.at });
    this.doc.pending.push(op);
    try {
      await this.deps.store.save(this.doc);
    } catch (e) {
      this.doc.pending.pop();
      throw e;
    }
    this.changed();
    return op as Op<T>;
  }

  /** Queues an op without local validation (used to ask to join a project we cannot see yet). */
  async enqueueRaw(op: Op): Promise<void> {
    this.doc.pending.push(op);
    await this.deps.store.save(this.doc);
    this.changed();
  }

  /** Removes a refused op from the rejected list once the user has seen it. */
  async dismissRejected(opId: string) {
    this.doc.rejected = this.doc.rejected.filter((r) => r.op.id !== opId);
    await this.deps.store.save(this.doc);
    this.changed();
  }

  /** Push local changes, then download new server ops. Safe to call any time; calls overlap into one. */
  sync(): Promise<SyncOutcome> {
    if (!this.syncing) {
      this.syncing = this.runSync().finally(() => {
        this.syncing = null;
      });
    }
    return this.syncing;
  }

  private async runSync(): Promise<SyncOutcome> {
    try {
      await this.pushPending();
      return await this.pullAll();
    } catch (e) {
      if (e instanceof OfflineError) return 'offline';
      throw e;
    }
  }

  private async pushPending() {
    const snapshot = this.doc.pending.slice();
    const rejected = new Map<string, PushResult & { status: 'rejected' }>();
    for (let i = 0; i < snapshot.length; i += 200) {
      let results: PushResult[];
      try {
        results = await this.deps.transport.push(this.doc.projectId, snapshot.slice(i, i + 200));
      } catch (e) {
        throw new OfflineError(String(e));
      }
      for (const r of results) if (r.status === 'rejected') rejected.set(r.opId, r);
    }
    if (rejected.size === 0) return;
    // Accepted ops stay in the queue until they show up in the pulled log; rejected ones move out.
    const keep: Op[] = [];
    for (const op of this.doc.pending) {
      const r = rejected.get(op.id);
      if (r) this.doc.rejected.push({ op, code: r.code, message: r.message });
      else keep.push(op);
    }
    this.doc.pending = keep;
    await this.deps.store.save(this.doc);
    this.changed();
  }

  private async pullAll(): Promise<SyncOutcome> {
    for (let page = 0; page < 10_000; page++) {
      let res: PullResult;
      try {
        res = await this.deps.transport.pull(this.doc.projectId, this.doc.lastSeq);
      } catch (e) {
        throw new OfflineError(String(e));
      }
      if (!res.ok) return this.handleNoAccess(res.reason);
      if (this.doc.access !== 'ok') this.doc.access = 'ok';
      if (res.ops.length === 0) {
        await this.afterPull();
        return 'synced';
      }
      this.applyPage(res.ops);
      await this.deps.store.save(this.doc);
      this.changed();
      if (this.doc.lastSeq >= res.head) {
        await this.afterPull();
        return 'synced';
      }
    }
    return 'synced';
  }

  private applyPage(ops: StoredOp[]) {
    let expected = this.doc.lastSeq + 1;
    let state = this.confirmedState ? cloneState(this.confirmedState) : null;
    for (const op of ops) {
      if (op.seq !== expected) throw new OfflineError(`Gap in server log at ${expected}`);
      state = applyOp(state, op, { seq: op.seq, serverAt: op.serverAt });
      expected++;
    }
    // Commit the page in memory only after it fully applied.
    this.doc.confirmed = this.doc.confirmed.concat(ops);
    this.doc.lastSeq = expected - 1;
    this.confirmedState = state;
    const confirmedIds = new Set(ops.map((o) => o.id));
    this.doc.pending = this.doc.pending.filter((o) => !confirmedIds.has(o.id));
  }

  private async afterPull() {
    const role = this.confirmedState?.members[this.deps.userId]?.role ?? null;
    if (this.doc.role === 'member' && role === 'admin') {
      // Admins may see details (e.g. NID) that were hidden before: download the log again.
      this.doc.role = role;
      this.doc.confirmed = [];
      this.doc.lastSeq = 0;
      this.confirmedState = null;
      await this.deps.store.save(this.doc);
      await this.pullAll();
      return;
    }
    if (this.doc.role !== role) {
      this.doc.role = role;
      await this.deps.store.save(this.doc);
    }
  }

  private async handleNoAccess(reason: 'not_found' | 'pending' | 'no_access'): Promise<SyncOutcome> {
    if (reason === 'not_found') {
      // A project created offline is not on the server until its first op is accepted.
      if (this.doc.lastSeq === 0) return 'synced';
      this.doc.access = 'purged';
      await this.deps.store.save(this.doc);
      this.changed();
      return 'purged';
    }
    this.doc.access = reason;
    await this.deps.store.save(this.doc);
    this.changed();
    return reason;
  }
}

export class OfflineError extends Error {}
