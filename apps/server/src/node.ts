import { serve } from '@hono/node-server';
import { Authority } from '@bm/core';
import { createApp } from './app';
import { Auth } from './auth';
import { SqliteStore } from './sqlite-store';

const port = Number(process.env.PORT ?? 8787);
const secret = process.env.AUTH_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-change-me-dev-secret-change-me');
const store = new SqliteStore(process.env.DB_PATH ?? 'budget-manager.sqlite');
const authority = new Authority(store);
const app = createApp({ authority, auth: new Auth(secret) });

// Daily housekeeping: auto-archive idle group projects, purge 30-day-old trash.
const sweep = () => authority.sweep(Date.now()).then((r) => r.archived.length + r.purged.length && console.log('sweep', r));
setInterval(sweep, 60 * 60 * 1000).unref();
void sweep();

serve({ fetch: app.fetch, port }, () => console.log(`Budget Manager sync server on http://localhost:${port}`));
