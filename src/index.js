/**
 * portfolio-middleware
 * ---------------------
 * A Cloudflare Worker (Hono + chanfana) that sits in front of the Render
 * backend for three purposes:
 *
 *   1. Serving the public "get all portfolio data" payload out of a
 *      Cloudflare KV cache, so GitHub Pages visitors never have to wait on
 *      a (possibly cold/sleeping) Render instance.
 *
 *   2. Absorbing public contact-form submissions so a visitor's request
 *      never has to wait on Render either. Messages are buffered in KV and
 *      batch-flushed to the backend every 6 hours by a Cron Trigger.
 *
 *   3. Acting as a single, fully-documented, token-protected front door for
 *      the rest of the portfolio's API (profile, skills, experience,
 *      projects, contact inbox) — every one of those routes is proxied
 *      straight through to the Render backend, unmodified, so the backend
 *      itself doesn't change at all.
 *
 * Authentication: every route (including GET requests) requires
 * `Authorization: Bearer <API_TOKEN>` — see src/lib/auth.js. There is no
 * separate user/admin tier at this layer; admin write routes additionally
 * require the backend's own admin JWT, forwarded via the `x-admin-token`
 * header (see src/lib/proxy.js).
 *
 * Abuse protection: every route is also rate-limited per IP (see
 * src/lib/rateLimit.js), enforced BEFORE the token check — so hammering
 * this worker is throttled whether or not the caller has a valid token.
 * This, not the token, is the actual defense against bots/scrapers
 * driving up cost — the token can't be kept truly secret on a public
 * static site, so it isn't the right tool for that job on its own.
 *
 * Interactive API docs (Swagger UI, auto-generated from the schema on each
 * endpoint class below, grouped by tag: Profile / Skill / Experience /
 * Projects / Contact) are served token-free at GET /api/docs, so anyone can
 * read them and use the "Authorize" button to try requests with a token.
 */

import { fromHono } from 'chanfana';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { FetchAll } from './endpoints/FetchAll.js';
import { SubmitContact } from './endpoints/SubmitContact.js';
import { RefreshCache } from './endpoints/RefreshCache.js';
import { FlushContacts } from './endpoints/FlushContacts.js';
import { GetProfile, GetProfileImage, UpdateProfile } from './endpoints/Profile.js';
import { ListSkills, CreateSkill, UpdateSkill, DeleteSkill } from './endpoints/Skills.js';
import {
  ListExperience,
  CreateExperience,
  UpdateExperience,
  DeleteExperience,
} from './endpoints/Experience.js';
import {
  ListProjects,
  GetProject,
  GetProjectImage,
  CreateProject,
  UpdateProject,
  DeleteProject,
} from './endpoints/Projects.js';
import {
  ListMessages,
  DeleteMessage,
  DeleteConversation,
  MarkConversationRead,
} from './endpoints/ContactAdmin.js';
import { refreshCache, flushPendingContacts } from './lib/kv.js';
import { isAuthorized, isPublicPath, securitySchema, ensureSecuritySchemeMiddleware } from './lib/auth.js';
import { rateLimitMiddleware } from './lib/rateLimit.js';

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
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-admin-token', 'x-refresh-secret'],
    maxAge: 86400,
  })
);

// Guarantees the OpenAPI spec's security scheme is present at
// /openapi.json, patched in after generation — see lib/auth.js for why
// this exists instead of relying on fromHono's schema-merge alone.
app.use('*', ensureSecuritySchemeMiddleware);

// Per-IP rate limit — runs before auth, so repeated hammering is
// throttled regardless of whether the caller has a valid token.
app.use('*', rateLimitMiddleware);

// Bearer-token gate — runs on every route except the docs UI / spec.
// (OPTIONS preflight never reaches here: the cors() middleware above
// answers it directly and doesn't call next().)
app.use('*', async (c, next) => {
  if (isPublicPath(c.req.path)) return next();
  if (!isAuthorized(c)) {
    return c.json({ message: 'Unauthorized. Provide a valid Bearer token.' }, 401);
  }
  return next();
});

// Sets up the interactive OpenAPI/Swagger docs UI, auto-generated from
// every endpoint's `schema` below.
const openapi = fromHono(app, {
  docs_url: '/api/docs',
  schema: {
    info: {
      title: 'Portfolio API',
      version: '1.0.0',
      description:
        'Every route requires the shared bearer token, including GET requests — click "Authorize" above ' +
        'and paste it in to try requests from this page.',
    },
    ...securitySchema,
  },
});

// --- Portfolio data cache + contact intake ---
openapi.get('/api/all', FetchAll);
openapi.post('/api/contact', SubmitContact);
openapi.post('/api/refresh', RefreshCache);
openapi.post('/api/message-refresh', FlushContacts);

// --- Profile ---
openapi.get('/api/profile', GetProfile);
openapi.get('/api/profile/image', GetProfileImage);
openapi.put('/api/profile', UpdateProfile);

// --- Skill ---
openapi.get('/api/skills', ListSkills);
openapi.post('/api/skills', CreateSkill);
openapi.put('/api/skills/:id', UpdateSkill);
openapi.delete('/api/skills/:id', DeleteSkill);

// --- Experience ---
openapi.get('/api/experience', ListExperience);
openapi.post('/api/experience', CreateExperience);
openapi.put('/api/experience/:id', UpdateExperience);
openapi.delete('/api/experience/:id', DeleteExperience);

// --- Projects ---
openapi.get('/api/projects', ListProjects);
openapi.get('/api/projects/:id', GetProject);
openapi.get('/api/projects/:id/image', GetProjectImage);
openapi.post('/api/projects', CreateProject);
openapi.put('/api/projects/:id', UpdateProject);
openapi.delete('/api/projects/:id', DeleteProject);

// --- Contact (admin inbox) — more specific paths registered before the
// generic /:id one so "conversation" is never mistaken for an id ---
openapi.get('/api/contact', ListMessages);
openapi.delete('/api/contact/conversation/:email', DeleteConversation);
openapi.patch('/api/contact/conversation/:email/read', MarkConversationRead);
openapi.delete('/api/contact/:id', DeleteMessage);

app.notFound((c) =>
  c.json(
    {
      message:
        'Not found. See GET /api/docs for the full list of routes this worker serves.',
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
