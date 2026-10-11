import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { Authority, Op } from '@bm/core';
import type { Auth } from './auth';

type Env = { Variables: { userId: string } };

/**
 * HTTP API. Platform-neutral (Hono): runs on Node (src/node.ts) and can run on
 * Cloudflare Workers with a Durable Object / D1 store.
 */
export function createApp(deps: { authority: Authority; auth: Auth; now?: () => number }) {
  const { authority, auth } = deps;
  const now = deps.now ?? Date.now;
  const app = new Hono<Env>();

  app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST'] }));
  app.use('*', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'too_large' }, 413) }));

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/v1/auth/device', async (c) => {
    const body = await c.req.json<{ userId?: string; secret?: string }>().catch(() => ({}) as { userId?: string; secret?: string });
    if (!body.userId) return c.json(await auth.issue());
    const result = await auth.register(body.userId, body.secret ?? '');
    return result ? c.json(result) : c.json({ error: 'id_taken' }, 409);
  });

  const v1 = new Hono<Env>();
  v1.use('*', async (c, next) => {
    const header = c.req.header('Authorization');
    const userId = await auth.verify(header?.startsWith('Bearer ') ? header.slice(7) : undefined);
    if (!userId) return c.json({ error: 'unauthorized' }, 401);
    c.set('userId', userId);
    await next();
  });

  v1.get('/projects', async (c) => c.json({ projects: await authority.listProjects(c.get('userId')) }));

  v1.post('/projects/:id/ops', async (c) => {
    const body = await c.req.json<{ ops?: Op[] }>().catch(() => null);
    if (!body || !Array.isArray(body.ops) || body.ops.length > 200) return c.json({ error: 'bad_request' }, 400);
    const results = await authority.push(c.get('userId'), c.req.param('id'), body.ops, now());
    return c.json({ results });
  });

  v1.get('/projects/:id/ops', async (c) => {
    const after = Number(c.req.query('after') ?? '0');
    if (!Number.isSafeInteger(after) || after < 0) return c.json({ error: 'bad_request' }, 400);
    return c.json(await authority.pull(c.get('userId'), c.req.param('id'), after));
  });

  v1.get('/projects/:id/membership', async (c) => {
    const m = await authority.membership(c.get('userId'), c.req.param('id'));
    return m ? c.json(m) : c.json({ error: 'not_found' }, 404);
  });

  v1.get('/invites/:code', async (c) => {
    const found = await authority.lookupInvite(c.req.param('code'));
    return found ? c.json(found) : c.json({ error: 'not_found' }, 404);
  });

  app.route('/v1', v1);
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'server_error' }, 500);
  });
  return app;
}
