/**
 * portfolio-middleware
 * ---------------------
 * A Cloudflare Worker that sits in front of the Render backend for two
 * purposes:
 *
 *   1. Serving the public "get all portfolio data" payload out of a
 *      Cloudflare KV cache, so GitHub Pages visitors never have to wait on
 *      a (possibly cold/sleeping) Render instance.
 *
 *   2. Absorbing public contact-form submissions so a visitor's request
 *      never has to wait on Render either. Messages are buffered in KV and
 *      batch-flushed to the backend every 6 hours by a Cron Trigger.
 *
 * Routes:
 *
 *   GET  /api/all      -> serves the cached data from KV. Falls back to a
 *                          live fetch + cache-populate on a cold/empty
 *                          cache so the site never breaks on first load.
 *
 *   POST /api/contact  -> validates and appends a message to the pending
 *                          KV buffer, then returns immediately. Nothing is
 *                          sent to the backend yet.
 *
 *   POST /api/refresh  -> pulls fresh data from the Render backend's own
 *                          /api/all endpoint and overwrites the KV cache.
 *                          Protected by a shared secret. Runs automatically
 *                          on the 5-minute Cron Trigger, and is also called
 *                          by the backend itself right after any admin
 *                          create/update/delete so the cache never needs to
 *                          wait for the next tick.
 *
 * Cron Triggers (see wrangler.toml):
 *   every 5 minutes -> refreshCache()            (keeps /api/all warm)
 *   every 6 hours    -> flushPendingContacts()    (batches contact messages)
 *
 * Everything else — admin login, admin create/update/delete, reading/
 * deleting messages in the admin inbox — is intentionally NOT handled
 * here. The frontend talks to the Render backend directly for all of that
 * (see README.md).
 */

import { API_DOCS_MARKDOWN } from './docs.js';

const DATA_KEY = 'portfolio:all';
const PENDING_CONTACTS_KEY = 'portfolio:pending-contacts';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGIN || '*').trim();

  // Supports a single origin, or a comma-separated list, or "*" for any.
  let allowOrigin = '*';
  if (allowed !== '*') {
    const list = allowed.split(',').map((o) => o.trim());
    allowOrigin = origin && list.includes(origin) ? origin : list[0];
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-refresh-secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

/** Renders the embedded API docs as a themed HTML page (Markdown parsed client-side). */
function docsPage(markdown) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>portfolio-middleware — API Docs</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<style>
  :root {
    --bg: #0B0E14;
    --surface: #11151C;
    --ink: #E6E8EB;
    --line: #1E232C;
    --violet: #7C5CFC;
    --mint: #45E0C4;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    line-height: 1.65;
  }
  #doc {
    max-width: 860px;
    margin: 0 auto;
    padding: 48px 24px 96px;
  }
  h1, h2, h3 { font-weight: 700; letter-spacing: -0.01em; }
  h1 {
    font-size: 2rem;
    background: linear-gradient(90deg, var(--violet), var(--mint));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    margin-bottom: 0.3em;
  }
  h2 {
    font-size: 1.35rem;
    margin-top: 2.5em;
    padding-bottom: 0.4em;
    border-bottom: 1px solid var(--line);
  }
  h3 { font-size: 1.05rem; margin-top: 1.8em; color: var(--mint); }
  p, li { color: #C7CAD1; }
  a { color: var(--mint); }
  code {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0.15em 0.4em;
    font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 0.88em;
    color: #F2A93B;
  }
  pre {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 16px 18px;
    overflow-x: auto;
  }
  pre code {
    background: none;
    border: none;
    padding: 0;
    color: var(--ink);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
    font-size: 0.92rem;
  }
  th, td {
    border: 1px solid var(--line);
    padding: 8px 12px;
    text-align: left;
  }
  th { background: var(--surface); color: var(--mint); }
  hr { border: none; border-top: 1px solid var(--line); margin: 2.5em 0; }
  blockquote {
    border-left: 3px solid var(--violet);
    margin: 1em 0;
    padding: 0.2em 1em;
    color: #9AA0AC;
  }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: #7C5CFC55; border-radius: 8px; }
</style>
</head>
<body>
  <div id="doc">Loading documentation…</div>
  <script>
    const markdownSource = ${JSON.stringify(markdown)};
    document.getElementById('doc').innerHTML = marked.parse(markdownSource);
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=UTF-8' },
  });
}

/** Calls the Render backend's own aggregate endpoint. */
async function fetchAllFromBackend(env) {
  if (!env.BACKEND_URL) {
    throw new Error('BACKEND_URL is not configured.');
  }
  const res = await fetch(`${env.BACKEND_URL}/all`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Backend responded with ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Fetches fresh data from the backend and overwrites the KV cache. */
async function refreshCache(env) {
  const data = await fetchAllFromBackend(env);
  const payload = { data, updatedAt: new Date().toISOString() };
  await env.PORTFOLIO_KV.put(DATA_KEY, JSON.stringify(payload));
  return payload;
}

function isAuthorizedRefresh(request, env, url) {
  if (!env.REFRESH_SECRET) return false;
  const headerSecret = request.headers.get('x-refresh-secret');
  const querySecret = url.searchParams.get('secret');
  return (headerSecret || querySecret) === env.REFRESH_SECRET;
}

/** Reads the buffered (not-yet-sent-to-backend) contact messages from KV. */
async function getPendingContacts(env) {
  const raw = await env.PORTFOLIO_KV.get(PENDING_CONTACTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function savePendingContacts(env, list) {
  if (!list.length) {
    await env.PORTFOLIO_KV.delete(PENDING_CONTACTS_KEY);
    return;
  }
  await env.PORTFOLIO_KV.put(PENDING_CONTACTS_KEY, JSON.stringify(list));
}

/**
 * Runs on the 6-hour Cron Trigger. If there's nothing buffered, it's a
 * no-op. Otherwise it POSTs every buffered message to the backend's public
 * /contact endpoint one at a time. Messages that succeed are dropped;
 * messages that fail (e.g. Render was briefly down) are kept in KV so
 * they're retried on the next tick instead of being lost.
 */
async function flushPendingContacts(env) {
  const pending = await getPendingContacts(env);
  if (!pending.length) {
    return { flushed: 0, remaining: 0 };
  }
  if (!env.BACKEND_URL) {
    throw new Error('BACKEND_URL is not configured.');
  }

  const stillPending = [];
  let flushed = 0;

  for (const message of pending) {
    try {
      const res = await fetch(`${env.BACKEND_URL}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: message.name,
          email: message.email,
          message: message.message,
        }),
      });
      if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
      flushed += 1;
    } catch (err) {
      console.error('Failed to flush contact message, will retry next cycle:', err.message);
      stillPending.push(message);
    }
  }

  // Erase the buffer down to only what still failed (empty = fully erased).
  await savePendingContacts(env, stillPending);

  return { flushed, remaining: stillPending.length };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // --- Docs: renders the embedded Markdown API reference as HTML ---
    if (url.pathname === '/api/docs' && request.method === 'GET') {
      return docsPage(API_DOCS_MARKDOWN);
    }

    // --- API #1: pull fresh data from the backend into KV ---
    if (url.pathname === '/api/refresh') {
      if (!isAuthorizedRefresh(request, env, url)) {
        return json({ message: 'Unauthorized.' }, 401, cors);
      }
      try {
        const result = await refreshCache(env);
        return json({ success: true, updatedAt: result.updatedAt }, 200, cors);
      } catch (err) {
        return json({ success: false, message: err.message }, 502, cors);
      }
    }

    // --- API #2: serve cached data to the public frontend ---
    if (url.pathname === '/api/all' && request.method === 'GET') {
      try {
        const cachedRaw = await env.PORTFOLIO_KV.get(DATA_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          return json(cached.data, 200, {
            ...cors,
            'X-Cache': 'HIT',
            'X-Cache-Updated-At': cached.updatedAt,
          });
        }

        // Cold cache (e.g. right after first deploy, before the first
        // cron tick) — fetch live once, populate KV, and serve it so the
        // site still works immediately.
        const fresh = await refreshCache(env);
        return json(fresh.data, 200, {
          ...cors,
          'X-Cache': 'MISS',
          'X-Cache-Updated-At': fresh.updatedAt,
        });
      } catch (err) {
        return json(
          { message: 'Failed to load portfolio data.', error: err.message },
          502,
          cors
        );
      }
    }

    // --- API #3: buffer a contact-form submission (does NOT touch the backend) ---
    if (url.pathname === '/api/contact' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ message: 'Invalid JSON body.' }, 400, cors);
      }

      const name = (body.name || '').trim();
      const email = (body.email || '').trim();
      const msg = (body.message || '').trim();

      if (!name || !email || !msg) {
        return json({ message: 'Name, email and message are all required.' }, 400, cors);
      }
      if (!EMAIL_RE.test(email)) {
        return json({ message: 'Please provide a valid email address.' }, 400, cors);
      }

      try {
        const pending = await getPendingContacts(env);
        pending.push({ name, email, message: msg, receivedAt: new Date().toISOString() });
        await savePendingContacts(env, pending);
        return json(
          { message: 'Message received successfully.' },
          201,
          cors
        );
      } catch (err) {
        return json(
          { message: 'Failed to store your message. Please try again.', error: err.message },
          502,
          cors
        );
      }
    }



    // --- API #4: Sends the pending contacts from middleware to backend ---
    if (url.pathname === "/api/test-flush") {
      const result = await flushPendingContacts(env);
      return json(result, 200, cors);
    }

    // Everything else — admin login, admin CRUD, reading/deleting messages
    // in the admin inbox, etc. — is handled by the frontend calling the
    // Render backend directly. This worker doesn't proxy those at all.
    return json(
      { message: 'Not found. This worker serves /api/all, /api/contact, /api/refresh and /api/docs.' },
      404,
      cors
    );
  },

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
