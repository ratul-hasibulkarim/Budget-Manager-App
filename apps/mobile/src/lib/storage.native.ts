import * as SQLite from 'expo-sqlite';
import type { DocStore, ProjectDoc } from '@bm/core';

/**
 * Phone storage for project documents: one SQLite row per project. A single-row write is atomic,
 * so a crash can never leave half of a project's data saved.
 */
export function createDocStore(): DocStore {
  const db = SQLite.openDatabaseSync('budget-manager.db');
  db.execSync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL);');
  return {
    async load(projectId) {
      const row = await db.getFirstAsync<{ body: string }>('SELECT body FROM docs WHERE id = ?', projectId);
      return row ? (JSON.parse(row.body) as ProjectDoc) : null;
    },
    async save(doc) {
      await db.runAsync('INSERT OR REPLACE INTO docs (id, body) VALUES (?, ?)', doc.projectId, JSON.stringify(doc));
    },
    async list() {
      const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM docs');
      return rows.map((r) => r.id);
    },
    async remove(projectId) {
      await db.runAsync('DELETE FROM docs WHERE id = ?', projectId);
    },
  };
}
