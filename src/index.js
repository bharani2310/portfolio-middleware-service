/**
 * portfolio-middleware
 * ---------------------
 * A Cloudflare Worker (Hono + chanfana) that sits in front of the Render
 * backend for two purposes:
 *
 *   1. Serving the public "get all portfolio data" payload out of a
 *      Cloudflare KV cache, so GitHub Pages visitors never have to wait on
 *      a (possibly cold/sleeping) Render instance.
 *
 *   2. Absorbing public contact-form submissions so a visitor's request
 *      never has to wait on Render either. Messages are buffered in KV and
 *      batch-flushed to the backend every 6 hours by a Cron Trigger.
 *
 * Interactive API docs (Swagger UI, auto-generated from the schema on each
 * endpoint class below) are served at GET /api/docs.
 *
 * Everything else — admin login, admin create/update/delete, reading/
 * deleting messages in the admin inbox — is intentionally NOT handled
 * here. The frontend talks to the Render backend directly for all of that
 * (see README.md).
 */

import { fromHono } from 'chanfana';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { FetchAll } from './endpoints/FetchAll.js';
import { SubmitContact } from './endpoints/SubmitContact.js';
import { RefreshCache } from './endpoints/RefreshCache.js';
import { FlushContacts } from './endpoints/FlushContacts.js';
import { refreshCache, flushPendingContacts } from './lib/kv.js';

const app = new Hono();

// CORS for every route. Origin is resolved from the ALLOWED_ORIGIN
// binding — supports "*", a single origin, or a comma-separated list.
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      const allowed = (c.env.ALLOWED_ORIGIN || '*').trim();
      if (allowed === '*') return '*';
      const list = allowed.split(',').map((o) => o.trim());
      return origin && list.includes(origin) ? origin : list[0];
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'x-refresh-secret'],
    maxAge: 86400,
  })
);

// Sets up the interactive OpenAPI/Swagger docs UI, auto-generated from
// every endpoint's `schema` below.
const openapi = fromHono(app, {
  docs_url: '/api/docs',
});

openapi.get('/api/all', FetchAll);
openapi.post('/api/contact', SubmitContact);
openapi.post('/api/refresh', RefreshCache);
openapi.post('/api/message-refresh', FlushContacts);

app.notFound((c) =>
  c.json(
    {
      message:
        'Not found. This worker serves /api/all, /api/contact, /api/refresh, /api/test-flush and /api/docs.',
    },
    404
  )
);

export default {
  fetch: app.fetch,

  /**
   * Cron Trigger — two schedules share this one handler (see wrangler.toml):
   *   every 5 minutes -> keeps the /api/all KV cache warm
   *   every 6 hours    -> flushes buffered contact messages to the backend
   */
  async scheduled(event, env, ctx) {
    if (event.cron === '0 */6 * * *') {
      ctx.waitUntil(
        flushPendingContacts(env).catch((err) => {
          console.error('Scheduled contact flush failed:', err.message);
        })
      );
      return;
    }

    ctx.waitUntil(
      refreshCache(env).catch((err) => {
        console.error('Scheduled cache refresh failed:', err.message);
      })
    );
  },
};
