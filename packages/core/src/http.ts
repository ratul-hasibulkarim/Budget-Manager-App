import type { ProjectListing, PullResult, PushResult } from './authority';
import type { Transport } from './engine';
import type { MemberStatus } from './model';
import type { Op } from './ops';

type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`HTTP ${status} ${code}`);
  }
}

/** Talks to the sync server. Network failures throw, which the sync engine treats as "offline". */
export class ApiClient implements Transport {
  constructor(
    private readonly baseUrl: string,
    public token: string | null,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly timeoutMs = 20000,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const request = this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), this.timeoutMs);
    });
    try {
      const res = await Promise.race([request, timeout]);
      const data = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) throw new HttpError(res.status, data?.error ?? 'error');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  registerDevice() {
    return this.call<{ userId: string; token: string }>('POST', '/v1/auth/device');
  }

  async push(projectId: string, ops: Op[]): Promise<PushResult[]> {
    return (await this.call<{ results: PushResult[] }>('POST', `/v1/projects/${encodeURIComponent(projectId)}/ops`, { ops })).results;
  }

  pull(projectId: string, afterSeq: number): Promise<PullResult> {
    return this.call<PullResult>('GET', `/v1/projects/${encodeURIComponent(projectId)}/ops?after=${afterSeq}`);
  }

  async listProjects(): Promise<ProjectListing[]> {
    return (await this.call<{ projects: ProjectListing[] }>('GET', '/v1/projects')).projects;
  }

  async lookupInvite(code: string): Promise<{ projectId: string; name: string; memberCount: number } | null> {
    try {
      return await this.call('GET', `/v1/invites/${encodeURIComponent(code.trim().toUpperCase())}`);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  membership(projectId: string) {
    return this.call<{ projectId: string; name: string; myStatus: MemberStatus | null }>('GET', `/v1/projects/${encodeURIComponent(projectId)}/membership`);
  }
}
