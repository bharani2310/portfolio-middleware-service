# portfolio-middleware

A small Cloudflare Worker that caches your portfolio's public "get all data"
payload in Cloudflare KV, so GitHub Pages visitors get instant responses
instead of waiting on your Render backend (which can be slow to wake up on
the free tier).

## How requests are routed

This worker is deliberately narrow — it only ever handles **two routes**:

| Route | Method | What it does |
|---|---|---|
| `/api/all` | `GET` | Serves the cached portfolio data from KV. Called by the public frontend. If the cache is empty (e.g. right after first deploy), it fetches live from the backend once, stores it, and serves it. |
| `/api/refresh` | `POST` (or `GET`) | Fetches fresh data from the Render backend's own `/api/all` and overwrites the KV cache. Protected by a secret. Also runs automatically every 5 minutes via a Cron Trigger. |

**Everything else bypasses this worker entirely** and goes straight from the
browser to your Render backend:
- Admin login (`/api/auth/login`) and all other auth routes
- All admin create/update/delete requests (profile, experience, skills,
  projects, messages)
- The public contact form submission (`POST /api/contact`)

That split is done on the **frontend**, not in this worker — see
"Frontend wiring" below. This worker never even sees those requests, so
there's nothing to misroute.

## One-time setup

1. **Install wrangler** (if you don't have it):
   ```bash
   npm install
   ```

2. **Create the KV namespace:**
   ```bash
   npx wrangler kv namespace create PORTFOLIO_KV
   ```
   This prints an `id`. Paste it into `wrangler.toml` under `kv_namespaces`.

3. **Set your backend URL and allowed origin** in `wrangler.toml`:
   ```toml
   BACKEND_URL = "https://your-render-backend.onrender.com/api"
   ALLOWED_ORIGIN = "https://your-username.github.io"
   ```

4. **Set the refresh secret** (used to authorize `/api/refresh` calls —
   never put this in `wrangler.toml`):
   ```bash
   npx wrangler secret put REFRESH_SECRET
   ```
   Pick any long random string.

5. **Deploy:**
   ```bash
   npx wrangler deploy
   ```
   This gives you a URL like `https://portfolio-middleware.<your-subdomain>.workers.dev`.

6. **Warm the cache once manually** (optional — the cron job will do this
   within 5 minutes anyway, and `/api/all` self-heals on a cold cache too):
   ```bash
   curl -X POST "https://portfolio-middleware.<your-subdomain>.workers.dev/api/refresh?secret=YOUR_REFRESH_SECRET"
   ```

## Frontend wiring

The frontend needs a **second** API base URL, used only for the one call
that fetches all portfolio data. Everything else keeps using your existing
`VITE_API_BASE_URL`, pointed straight at Render.

In your frontend's `.env` (or GitHub Actions build secrets):
```
VITE_API_BASE_URL=https://your-render-backend.onrender.com/api
VITE_DATA_API_BASE_URL=https://portfolio-middleware.<your-subdomain>.workers.dev/api
```

Two frontend files were changed to support this — see the accompanying
`frontend/src/api/dataApi.js` (new) and `frontend/src/hooks/usePortfolioData.js`
(updated) files. No backend code changes were needed at all — the worker
just calls your existing `GET /api/all` endpoint.

## Keeping the cache fresh after an admin edit

Right now the cache refreshes automatically every 5 minutes via the Cron
Trigger, and self-heals on a cold miss. That means after an admin saves a
change, it can take **up to 5 minutes** to show up on the public site.

If you want changes to appear instantly instead, you can optionally call
the refresh endpoint right after a successful admin save, e.g. from the
frontend admin pages:

```js
fetch('https://portfolio-middleware.<your-subdomain>.workers.dev/api/refresh?secret=YOUR_REFRESH_SECRET', { method: 'POST' });
```

This wasn't wired in automatically since it means embedding the refresh
secret somewhere the admin's browser can read it — happy to help set this
up securely (e.g. having the backend call it server-side instead, so the
secret never reaches the browser) if you want it.

## Local development

```bash
cp .dev.vars.example .dev.vars   # then edit in your own REFRESH_SECRET
npx wrangler dev
```
