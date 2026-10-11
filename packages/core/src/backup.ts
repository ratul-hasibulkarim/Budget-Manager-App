import type { ProjectDoc } from './engine';

/**
 * Backup file format. Contains every project document (server-confirmed log + unsent changes),
 * so a restore can never lose or duplicate entries: restored docs are merged by op id.
 */
export interface BackupFile {
  app: 'budget-manager';
  format: 1;
  exportedAt: number;
  userId: string;
  /**
   * The phone's account (id + secret), so a new phone restored from this file is the same
   * person and keeps access to their groups. Keep backup files private.
   */
  account?: { userId: string; secret: string };
  projects: ProjectDoc[];
  checksum: string;
}

export class BackupError extends Error {}

/** FNV-1a 32-bit, enough to detect a damaged or edited file. */
function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function createBackup(userId: string, projects: ProjectDoc[], now: number, account?: { userId: string; secret: string }): string {
  const body = JSON.stringify([projects, account ?? null]);
  const file: BackupFile = { app: 'budget-manager', format: 1, exportedAt: now, userId, account, projects, checksum: checksum(body) };
  return JSON.stringify(file);
}

export function readBackup(text: string): BackupFile {
  let file: BackupFile;
  try {
    file = JSON.parse(text) as BackupFile;
  } catch {
    throw new BackupError('Not a backup file');
  }
  if (file?.app !== 'budget-manager' || file.format !== 1 || !Array.isArray(file.projects)) throw new BackupError('Not a backup file');
  if (checksum(JSON.stringify([file.projects, file.account ?? null])) !== file.checksum) throw new BackupError('The backup file is damaged');
  return file;
}

/**
 * Merges a restored doc into the local one. The longer confirmed log wins (logs from the same
 * server are prefixes of each other); pending ops are united by id and dropped if confirmed.
 */
export function mergeDocs(local: ProjectDoc | null, restored: ProjectDoc): ProjectDoc {
  if (!local) return restored;
  const base = restored.lastSeq > local.lastSeq ? restored : local;
  const confirmedIds = new Set(base.confirmed.map((o) => o.id));
  const pending = [...local.pending];
  const seen = new Set(pending.map((o) => o.id));
  for (const op of restored.pending) if (!seen.has(op.id)) pending.push(op);
  const rejectedSeen = new Set(local.rejected.map((r) => r.op.id));
  return {
    ...base,
    pending: pending.filter((o) => !confirmedIds.has(o.id)),
    rejected: [...local.rejected, ...restored.rejected.filter((r) => !rejectedSeen.has(r.op.id))],
  };
}
