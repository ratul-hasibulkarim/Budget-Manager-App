import type { DocStore, ProjectDoc } from '@bm/core';

/**
 * Web storage for project documents (localStorage). Each document is written as one value,
 * which the browser stores atomically. The native app uses SQLite instead (storage.native.ts).
 */
const PREFIX = 'bm.doc.';

export function createDocStore(): DocStore {
  return {
    async load(projectId) {
      const raw = globalThis.localStorage?.getItem(PREFIX + projectId);
      return raw ? (JSON.parse(raw) as ProjectDoc) : null;
    },
    async save(doc) {
      globalThis.localStorage.setItem(PREFIX + doc.projectId, JSON.stringify(doc));
    },
    async list() {
      const ids: string[] = [];
      const ls = globalThis.localStorage;
      if (!ls) return ids;
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k?.startsWith(PREFIX)) ids.push(k.slice(PREFIX.length));
      }
      return ids;
    },
    async remove(projectId) {
      globalThis.localStorage.removeItem(PREFIX + projectId);
    },
  };
}
