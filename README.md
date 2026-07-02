# portfolio-middleware

A small Cloudflare Worker that caches your portfolio's public "get all data"
payload in Cloudflare KV, so GitHub Pages visitors get instant responses
instead of waiting on your Render backend (which can be slow to wake up on
the free tier).

## How requests are routed

This worker is deliberately narrow — it only ever handles a handful of routes:

| Route | Method | What it does |
|---|---|---|
| `/api/all` | `GET` | Serves the cached portfolio data from KV. Called by the public frontend. If the cache is empty (e.g. right after first deploy), it fetches live from the backend once, stores it, and serves it. |
| `/api/contact` | `POST` | Buffers a contact-form submission in KV. Flushed to the backend every 6 hours (or manually via `/api/test-flush`). |
| `/api/refresh` | `POST` | Fetches fresh data from the Render backend's own `/api/all` and overwrites the KV cache. Protected by a secret. Runs automatically every 5 minutes via a Cron Trigger, and is also called by the backend itself right after any admin save. |
| `/api/test-flush` | `POST` | Manually runs the contact-flush job without waiting for its 6-hour schedule. Useful for testing. |
| `/api/docs` | `GET` | Interactive Swagger-style API documentation, auto-generated from each route's schema (powered by [chanfana](https://github.com/cloudflare/chanfana)). |

**Admin login, admin CRUD, and the admin message inbox bypass this worker
entirely** and go straight from the browser to your Render backend. That
split is done on the **frontend**, not in this worker — see "Frontend
wiring" below. This worker never even sees those requests, so there's
nothing to misroute.

## API Documentation

Full interactive docs (request/response schemas, try-it-out) are served
live at:

```
https://portfolio-middleware.<your-subdomain>.workers.dev/api/docs
```

A plain-Markdown version of the same reference also lives in this repo at
[`API_DOCUMENTATION.md`](./API_DOCUMENTATION.md).

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

The cache refreshes automatically every 5 minutes via the Cron Trigger,
and self-heals on a cold miss. On top of that, the Render backend already
pings `POST /api/refresh` itself right after any admin create/update/delete
(see `backend/src/services/notifyMiddleware.js`), so changes typically show
up on the public site within a second or two — not the full 5 minutes.

## Local development

```bash
cp .dev.vars.example .dev.vars   # then edit in your own REFRESH_SECRET
npx wrangler dev
```
