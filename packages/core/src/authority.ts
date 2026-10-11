import { AUTO_ARCHIVE_AFTER_MS, TRASH_RETENTION_MS, type MemberStatus, type ProjectState } from './model';
import { SYSTEM_ACTOR, type Op, type StoredOp } from './ops';
import { applyOp, cloneState, OpError } from './reducer';
import { redactFor } from './redact';

/**
 * The server side of sync. It is the single place where a project's ops get their order.
 * Storage is pluggable (in-memory for tests, SQLite on the server, Durable Objects later).
 */

export type PushResult =
  | { opId: string; status: 'accepted' | 'duplicate'; seq: number }
  | { opId: string; status: 'rejected'; code: string; message: string };

export type PullResult =
  | { ok: true; ops: StoredOp[]; head: number }
  | { ok: false; reason: 'not_found' | 'pending' | 'no_access' };

export interface ProjectListing {
  projectId: string;
  name: string;
  type: ProjectState['type'];
  status: ProjectState['status'];
  myStatus: MemberStatus;
  lastActivityAt: number;
}

export interface AuthorityStore {
  getProject(projectId: string): Promise<{ state: ProjectState; head: number } | null>;
  /** Looks up an accepted op by id in any project. */
  getOp(opId: string): Promise<{ projectId: string; seq: number } | null>;
  getRejection(opId: string): Promise<{ code: string; message: string } | null>;
  /**
   * Atomically appends the op and saves the new state, and refreshes the invite-code and
   * membership indexes from the new state.
   */
  commit(op: StoredOp, state: ProjectState): Promise<void>;
  recordRejection(opId: string, projectId: string, code: string, message: string): Promise<void>;
  listOps(projectId: string, afterSeq: number, limit: number): Promise<StoredOp[]>;
  findProjectByInvite(code: string): Promise<string | null>;
  listProjectIds(): Promise<string[]>;
  listProjectIdsForUser(userId: string): Promise<string[]>;
  deleteProject(projectId: string): Promise<void>;
}

const OP_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const PULL_LIMIT = 500;

export class Authority {
  private locks = new Map<string, Promise<unknown>>();

  constructor(private readonly store: AuthorityStore) {}

  /** Runs `fn` with exclusive access to one project, so ops are ordered strictly one at a time. */
  private async withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const chained = prev.then(() => next);
    this.locks.set(projectId, chained);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(projectId) === chained) this.locks.delete(projectId);
    }
  }

  async push(actorId: string, projectId: string, ops: Op[], now: number): Promise<PushResult[]> {
    return this.withLock(projectId, async () => {
      const loaded = await this.store.getProject(projectId);
      let state = loaded?.state ?? null;
      let head = loaded?.head ?? 0;
      const results: PushResult[] = [];
      for (const op of ops) {
        const id = typeof op?.id === 'string' ? op.id : '';
        const reject = async (code: string, message: string, record = true) => {
          if (record && OP_ID_RE.test(id)) await this.store.recordRejection(id, projectId, code, message);
          results.push({ opId: id, status: 'rejected', code, message });
        };
        if (!OP_ID_RE.test(id)) {
          await reject('invalid', 'Bad op id', false);
          continue;
        }
        // Idempotency: an op that was already decided gets the same answer again.
        const seen = await this.store.getOp(id);
        if (seen) {
          if (seen.projectId !== projectId) await reject('invalid', 'Op id already used', false);
          else results.push({ opId: id, status: 'duplicate', seq: seen.seq });
          continue;
        }
        const rejected = await this.store.getRejection(id);
        if (rejected) {
          results.push({ opId: id, status: 'rejected', ...rejected });
          continue;
        }
        if (op.projectId !== projectId) {
          await reject('invalid', 'Op belongs to another project');
          continue;
        }
        if (op.actorId !== actorId || actorId === SYSTEM_ACTOR) {
          await reject('forbidden', 'Op was not created by you');
          continue;
        }
        if (op.type === 'project.autoArchive') {
          await reject('forbidden', 'Only the server can auto-archive');
          continue;
        }
        if (op.type === 'project.setInviteCode' && op.payload?.code) {
          const owner = await this.store.findProjectByInvite(op.payload.code);
          if (owner && owner !== projectId) {
            await reject('invite_taken', 'This invite code is already used, try again');
            continue;
          }
        }
        const stored = { ...op, seq: head + 1, serverAt: now } as StoredOp;
        let next: ProjectState;
        try {
          next = applyOp(state ? cloneState(state) : null, stored, { seq: stored.seq, serverAt: now });
        } catch (e) {
          if (e instanceof OpError) await reject(e.code, e.message);
          else await reject('invalid', 'Malformed operation');
          continue;
        }
        await this.store.commit(stored, next);
        state = next;
        head = stored.seq;
        results.push({ opId: id, status: 'accepted', seq: stored.seq });
      }
      return results;
    });
  }

  async pull(viewerId: string, projectId: string, afterSeq: number, limit = PULL_LIMIT): Promise<PullResult> {
    const loaded = await this.store.getProject(projectId);
    if (!loaded) return { ok: false, reason: 'not_found' };
    const me = loaded.state.members[viewerId];
    if (!me || me.status !== 'active') return { ok: false, reason: me?.status === 'pending' ? 'pending' : 'no_access' };
    const ops = await this.store.listOps(projectId, Math.max(0, Math.floor(afterSeq)), Math.min(limit, PULL_LIMIT));
    return { ok: true, ops: ops.map((op) => redactFor(op, viewerId, loaded.state)), head: loaded.head };
  }

  /** What a user who is not (yet) an active member may know about a project. */
  async membership(viewerId: string, projectId: string) {
    const loaded = await this.store.getProject(projectId);
    if (!loaded) return null;
    return { projectId, name: loaded.state.name, myStatus: loaded.state.members[viewerId]?.status ?? null };
  }

  async lookupInvite(code: string) {
    const projectId = await this.store.findProjectByInvite(code.trim().toUpperCase());
    if (!projectId) return null;
    const loaded = await this.store.getProject(projectId);
    if (!loaded || loaded.state.inviteCode !== code.trim().toUpperCase() || loaded.state.status !== 'active') return null;
    const s = loaded.state;
    return {
      projectId,
      name: s.name,
      memberCount: Object.values(s.members).filter((m) => m.status === 'active').length,
    };
  }

  async listProjects(userId: string): Promise<ProjectListing[]> {
    const ids = await this.store.listProjectIdsForUser(userId);
    const out: ProjectListing[] = [];
    for (const projectId of ids) {
      const loaded = await this.store.getProject(projectId);
      const me = loaded?.state.members[userId];
      if (!loaded || !me) continue;
      const s = loaded.state;
      out.push({ projectId, name: s.name, type: s.type, status: s.status, myStatus: me.status, lastActivityAt: s.lastActivityAt });
    }
    return out;
  }

  /** Daily housekeeping: auto-archive idle group projects and purge old trash. */
  async sweep(now: number): Promise<{ archived: string[]; purged: string[] }> {
    const archived: string[] = [];
    const purged: string[] = [];
    for (const projectId of await this.store.listProjectIds()) {
      await this.withLock(projectId, async () => {
        const loaded = await this.store.getProject(projectId);
        if (!loaded) return;
        const s = loaded.state;
        if (s.status === 'trashed' && now - s.statusChangedAt >= TRASH_RETENTION_MS) {
          await this.store.deleteProject(projectId);
          purged.push(projectId);
        } else if (s.type === 'group' && s.status === 'active' && now - s.lastActivityAt >= AUTO_ARCHIVE_AFTER_MS) {
          const op = {
            id: `auto-archive-${loaded.head + 1}-${projectId}`.slice(0, 64),
            projectId,
            actorId: SYSTEM_ACTOR,
            at: now,
            type: 'project.autoArchive',
            payload: {},
            seq: loaded.head + 1,
            serverAt: now,
          } as StoredOp;
          const next = applyOp(cloneState(s), op, { seq: op.seq, serverAt: now });
          await this.store.commit(op, next);
          archived.push(projectId);
        }
      });
    }
    return { archived, purged };
  }
}

/** In-memory store, used by tests and the offline simulator. */
export class MemoryAuthorityStore implements AuthorityStore {
  projects = new Map<string, { state: ProjectState; ops: StoredOp[] }>();
  opIndex = new Map<string, { projectId: string; seq: number }>();
  rejections = new Map<string, { code: string; message: string }>();

  async getProject(projectId: string) {
    const p = this.projects.get(projectId);
    return p ? { state: cloneState(p.state), head: p.ops.length } : null;
  }
  async getOp(opId: string) {
    return this.opIndex.get(opId) ?? null;
  }
  async getRejection(opId: string) {
    return this.rejections.get(opId) ?? null;
  }
  async commit(op: StoredOp, state: ProjectState) {
    const p = this.projects.get(op.projectId) ?? { state, ops: [] };
    if (op.seq !== p.ops.length + 1) throw new Error('Sequence gap');
    p.ops.push(JSON.parse(JSON.stringify(op)));
    p.state = cloneState(state);
    this.projects.set(op.projectId, p);
    this.opIndex.set(op.id, { projectId: op.projectId, seq: op.seq });
  }
  async recordRejection(opId: string, _projectId: string, code: string, message: string) {
    this.rejections.set(opId, { code, message });
  }
  async listOps(projectId: string, afterSeq: number, limit: number) {
    return (this.projects.get(projectId)?.ops ?? []).slice(afterSeq, afterSeq + limit).map((o) => JSON.parse(JSON.stringify(o)));
  }
  async findProjectByInvite(code: string) {
    for (const [id, p] of this.projects) if (p.state.inviteCode === code) return id;
    return null;
  }
  async listProjectIds() {
    return [...this.projects.keys()];
  }
  async listProjectIdsForUser(userId: string) {
    return [...this.projects].filter(([, p]) => p.state.members[userId]).map(([id]) => id);
  }
  async deleteProject(projectId: string) {
    const p = this.projects.get(projectId);
    if (!p) return;
    for (const op of p.ops) this.opIndex.delete(op.id);
    this.projects.delete(projectId);
  }
}
