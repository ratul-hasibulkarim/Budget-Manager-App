import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import {
  ApiClient,
  createBackup,
  emptyDoc,
  makeOp,
  mergeDocs,
  newId,
  ProjectSync,
  readBackup,
  type DocStore,
  type OpPayloads,
  type OpType,
  type ProjectState,
} from '@bm/core';
import { createDocStore } from './storage';
import { useSettings } from './settings';

export type NetStatus = 'idle' | 'syncing' | 'synced' | 'offline';

interface Ctx {
  ready: boolean;
  userId: string;
  projects: ProjectSync[];
  net: NetStatus;
  /** Bumps whenever any project changes (for lists). */
  version: number;
  get(projectId: string): ProjectSync | undefined;
  createProject(payload: OpPayloads['project.create']): Promise<string>;
  lookupInvite(code: string): Promise<{ projectId: string; name: string; memberCount: number } | null>;
  requestJoin(projectId: string, name: string, code: string, displayName: string): Promise<void>;
  syncAll(): Promise<void>;
  /** Saves a change and starts syncing in the background. Throws OpError if not allowed. */
  submit<T extends OpType>(projectId: string, type: T, payload: OpPayloads[T]): Promise<void>;
  exportBackup(): Promise<string>;
  importBackup(text: string): Promise<number>;
  forget(projectId: string): Promise<void>;
}

const WorkspaceContext = createContext<Ctx | null>(null);
const SYNC_EVERY_MS = 20_000;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { settings, ready: settingsReady, update } = useSettings();
  const account = settings.account;
  const store = useMemo<DocStore>(() => createDocStore(), []);
  const api = useMemo(() => new ApiClient(settings.serverUrl, account?.token ?? null), [settings.serverUrl, account?.token]);
  const syncs = useRef(new Map<string, ProjectSync>());
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [net, setNet] = useState<NetStatus>('idle');
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const deps = useCallback(
    () => ({ store, transport: api, userId: account!.userId, newId, now: () => Date.now() }),
    [store, api, account],
  );

  const open = useCallback(
    async (projectId: string, initial?: Parameters<typeof mergeDocs>[1]) => {
      let s = syncs.current.get(projectId);
      if (!s) {
        const doc = initial ?? (await store.load(projectId)) ?? emptyDoc(projectId);
        s = new ProjectSync(doc, deps());
        s.subscribe(bump);
        syncs.current.set(projectId, s);
      }
      return s;
    },
    [store, deps, bump],
  );

  // Load all projects stored on this phone. Recreated when the server/account changes.
  useEffect(() => {
    if (!settingsReady || !account) return;
    let cancelled = false;
    (async () => {
      syncs.current = new Map();
      for (const id of await store.list()) {
        if (cancelled) return;
        await open(id);
      }
      setReady(true);
      bump();
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsReady, account, store, open, bump]);

  const running = useRef<Promise<void> | null>(null);
  const syncAll = useCallback(async () => {
    if (!account) return;
    if (running.current) return running.current;
    running.current = (async () => {
      setNet('syncing');
      let offline = false;
      try {
        if (!account.token) {
          try {
            const res = await api.registerDevice({ userId: account.userId, secret: account.secret });
            update({ account: { ...account, token: res.token } });
            api.token = res.token;
          } catch {
            offline = true;
          }
        }
        if (!offline) {
          // Discover projects this account belongs to (e.g. on a new phone).
          try {
            for (const p of await api.listProjects()) {
              if (!syncs.current.has(p.projectId) && (p.myStatus === 'active' || p.myStatus === 'pending')) {
                const s = await open(p.projectId, { ...emptyDoc(p.projectId), placeholderName: p.name });
                await store.save(s.doc);
              }
            }
          } catch {
            offline = true;
          }
        }
        for (const s of syncs.current.values()) {
          if (s.doc.access === 'purged') continue;
          try {
            const r = await s.sync();
            if (r === 'offline') offline = true;
          } catch {
            offline = true;
          }
        }
      } finally {
        setNet(offline ? 'offline' : 'synced');
        running.current = null;
        bump();
      }
    })();
    return running.current;
  }, [account, api, open, store, update, bump]);

  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => void syncAll(), 400);
  }, [syncAll]);

  useEffect(() => {
    if (!ready) return;
    void syncAll();
    const timer = setInterval(() => void syncAll(), SYNC_EVERY_MS);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void syncAll());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [ready, syncAll]);

  const value = useMemo<Ctx>(
    () => ({
      ready,
      userId: account?.userId ?? '',
      projects: [...syncs.current.values()],
      net,
      version,
      get: (id) => syncs.current.get(id),
      async createProject(payload) {
        const projectId = newId();
        const s = await open(projectId);
        await s.submit('project.create', payload);
        bump();
        scheduleSync();
        return projectId;
      },
      lookupInvite: (code) => api.lookupInvite(code),
      async requestJoin(projectId, name, code, displayName) {
        const s = await open(projectId, { ...emptyDoc(projectId), placeholderName: name });
        await s.enqueueRaw(
          makeOp('member.requestJoin', { inviteCode: code.trim().toUpperCase(), name: displayName || undefined }, {
            id: newId(),
            projectId,
            actorId: account!.userId,
            at: Date.now(),
          }),
        );
        bump();
        await syncAll();
      },
      syncAll,
      async submit(projectId, type, payload) {
        const s = syncs.current.get(projectId);
        if (!s) throw new Error('Unknown project');
        await s.submit(type, payload);
        scheduleSync();
      },
      async exportBackup() {
        const docs = [];
        for (const id of await store.list()) {
          const d = await store.load(id);
          if (d) docs.push(d);
        }
        return createBackup(account!.userId, docs, Date.now(), { userId: account!.userId, secret: account!.secret });
      },
      async importBackup(text) {
        const file = readBackup(text);
        // On a phone that has no projects of its own yet (e.g. a new phone), become the account
        // from the backup so the person keeps access to their groups.
        const hasOwnData = [...syncs.current.values()].some((s) => s.doc.lastSeq > 0 || s.doc.pending.length > 0);
        if (file.account && file.account.userId !== account?.userId && !hasOwnData) {
          syncs.current = new Map();
          for (const restored of file.projects) await store.save(restored);
          update({ account: { userId: file.account.userId, secret: file.account.secret } });
          return file.projects.length;
        }
        for (const restored of file.projects) {
          const existing = syncs.current.get(restored.projectId);
          const merged = mergeDocs(existing?.doc ?? (await store.load(restored.projectId)), restored);
          await store.save(merged);
          syncs.current.delete(restored.projectId);
          await open(restored.projectId, merged);
        }
        bump();
        scheduleSync();
        return file.projects.length;
      },
      async forget(projectId) {
        syncs.current.delete(projectId);
        await store.remove(projectId);
        bump();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, account, net, version, open, api, store, syncAll, scheduleSync, bump],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Ctx {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('WorkspaceProvider missing');
  return ctx;
}

/** A project's current state (including unsynced local changes); re-renders on every change. */
export function useProject(projectId: string): { sync: ProjectSync | undefined; state: ProjectState | null } {
  const ws = useWorkspace();
  const sync = ws.get(projectId);
  const subscribe = useCallback((fn: () => void) => (sync ? sync.subscribe(fn) : () => {}), [sync]);
  const state = useSyncExternalStore(subscribe, () => sync?.state ?? null, () => sync?.state ?? null);
  return { sync, state };
}
