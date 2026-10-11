import { DatabaseSync } from 'node:sqlite';
import type { AuthorityStore, ProjectState, StoredOp } from '@bm/core';
import type { UserStore } from './auth';

/**
 * SQLite storage for the sync server. The same schema works on Cloudflare D1 / Durable Objects.
 * Each commit (append op + save state + refresh indexes) is one transaction.
 */
export class SqliteStore implements AuthorityStore, UserStore {
  private db: DatabaseSync;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        head INTEGER NOT NULL,
        invite_code TEXT UNIQUE
      );
      CREATE TABLE IF NOT EXISTS ops (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        body TEXT NOT NULL,
        UNIQUE (project_id, seq)
      );
      CREATE TABLE IF NOT EXISTS rejections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        code TEXT NOT NULL,
        message TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        secret_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS memberships (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        PRIMARY KEY (user_id, project_id)
      );
    `);
  }

  async getProject(projectId: string) {
    const row = this.db.prepare('SELECT state, head FROM projects WHERE id = ?').get(projectId) as { state: string; head: number } | undefined;
    return row ? { state: JSON.parse(row.state) as ProjectState, head: Number(row.head) } : null;
  }

  async getOp(opId: string) {
    const row = this.db.prepare('SELECT project_id, seq FROM ops WHERE id = ?').get(opId) as { project_id: string; seq: number } | undefined;
    return row ? { projectId: row.project_id, seq: Number(row.seq) } : null;
  }

  async getRejection(opId: string) {
    const row = this.db.prepare('SELECT code, message FROM rejections WHERE id = ?').get(opId) as { code: string; message: string } | undefined;
    return row ?? null;
  }

  async commit(op: StoredOp, state: ProjectState) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const cur = this.db.prepare('SELECT head FROM projects WHERE id = ?').get(op.projectId) as { head: number } | undefined;
      if (Number(cur?.head ?? 0) + 1 !== op.seq) throw new Error('Sequence gap');
      this.db
        .prepare(
          `INSERT INTO projects (id, state, head, invite_code) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET state = excluded.state, head = excluded.head, invite_code = excluded.invite_code`,
        )
        .run(op.projectId, JSON.stringify(state), op.seq, state.inviteCode);
      this.db.prepare('INSERT INTO ops (id, project_id, seq, body) VALUES (?, ?, ?, ?)').run(op.id, op.projectId, op.seq, JSON.stringify(op));
      const add = this.db.prepare('INSERT OR IGNORE INTO memberships (project_id, user_id) VALUES (?, ?)');
      for (const userId of Object.keys(state.members)) add.run(op.projectId, userId);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async recordRejection(opId: string, projectId: string, code: string, message: string) {
    this.db.prepare('INSERT OR IGNORE INTO rejections (id, project_id, code, message) VALUES (?, ?, ?, ?)').run(opId, projectId, code, message);
  }

  async listOps(projectId: string, afterSeq: number, limit: number) {
    const rows = this.db
      .prepare('SELECT body FROM ops WHERE project_id = ? AND seq > ? ORDER BY seq LIMIT ?')
      .all(projectId, afterSeq, limit) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as StoredOp);
  }

  async findProjectByInvite(code: string) {
    const row = this.db.prepare('SELECT id FROM projects WHERE invite_code = ?').get(code) as { id: string } | undefined;
    return row?.id ?? null;
  }

  async listProjectIds() {
    return (this.db.prepare('SELECT id FROM projects').all() as { id: string }[]).map((r) => r.id);
  }

  async listProjectIdsForUser(userId: string) {
    return (this.db.prepare('SELECT project_id FROM memberships WHERE user_id = ?').all(userId) as { project_id: string }[]).map((r) => r.project_id);
  }

  async deleteProject(projectId: string) {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  }

  async getUserSecretHash(userId: string) {
    const row = this.db.prepare('SELECT secret_hash FROM users WHERE id = ?').get(userId) as { secret_hash: string } | undefined;
    return row?.secret_hash ?? null;
  }

  async insertUser(userId: string, secretHash: string) {
    return Number(this.db.prepare('INSERT OR IGNORE INTO users (id, secret_hash) VALUES (?, ?)').run(userId, secretHash).changes) === 1;
  }

  close() {
    this.db.close();
  }
}
