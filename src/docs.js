/**
 * Raw Markdown source for the middleware's API documentation.
 * Served (rendered client-side) at GET /api/docs.
 */
export const API_DOCS_MARKDOWN = `# portfolio-middleware — API Documentation

Base URL (production): \`https://portfolio-middleware.<your-subdomain>.workers.dev\`

> This documentation is also served live at
> **\`GET /api/docs\`** on the Worker itself — e.g.
> \`https://portfolio-middleware.<your-subdomain>.workers.dev/api/docs\`.

This Worker sits in front of the Render backend and exposes exactly three
public routes plus one protected route. It is **not** a general-purpose
proxy — every other request (admin login, admin CRUD, admin inbox) goes
straight to the Render backend and is intentionally not handled here.

All responses are JSON with header \`Content-Type: application/json\`,
except \`OPTIONS\` preflight responses (\`204 No Content\`, no body).

---

## Authentication

Only \`POST /api/refresh\` requires authentication. It uses a shared-secret
header rather than JWT, since it's called by the backend and by Cloudflare
Cron, not by end users.

| Header | Required on | Description |
|---|---|---|
| \`x-refresh-secret\` | \`POST /api/refresh\` | Must match the Worker's \`REFRESH_SECRET\` binding. Can alternatively be passed as a \`?secret=\` query param. |

---

## CORS

All routes respond with CORS headers computed from the Worker's
\`ALLOWED_ORIGIN\` binding:

- \`ALLOWED_ORIGIN = "*"\` → any origin allowed.
- \`ALLOWED_ORIGIN = "https://foo.com"\` → only that origin allowed.
- \`ALLOWED_ORIGIN = "https://foo.com,https://bar.com"\` → comma-separated allow-list.

Response headers on every route:

\`\`\`
Access-Control-Allow-Origin: <resolved origin>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, x-refresh-secret
Access-Control-Max-Age: 86400
Vary: Origin
\`\`\`

\`OPTIONS\` requests to any path return \`204\` with the headers above and no
body (CORS preflight).

---

## GET /api/all

Serves the full portfolio payload (profile, experience, skills, projects)
out of the Cloudflare KV cache. This is the endpoint the public frontend
calls — visitors never hit Render directly.

**Method:** \`GET\`
**Auth:** none
**Query params:** none

### Behavior

1. Reads \`portfolio:all\` from KV.
2. **Cache hit** → returns the cached payload immediately.
3. **Cache miss** (e.g. right after first deploy, before the first cron
   tick) → fetches live from the backend's \`GET {BACKEND_URL}/all\`,
   writes it to KV, and returns it. So the very first visitor after a
   cold start pays a one-time live-fetch cost; everyone after that hits
   the cache.

### Response — 200 OK

\`\`\`json
{
  "profile": {
    "_id": "…",
    "name": "Alex Carter",
    "role": "Full Stack Developer",
    "description": "…",
    "professionalSummary": "…",
    "currentCompany": "…",
    "location": "Remote",
    "resumeLink": "https://…",
    "profileImage": "data:image/webp;base64,UklGRi…",
    "socialLinks": { "github": "https://…", "linkedin": "https://…" }
  },
  "experience": [
    {
      "_id": "…",
      "companyName": "Nimbus Labs",
      "technologies": ["React", "Node.js"],
      "roles": [
        {
          "role": "Senior Full Stack Developer",
          "startDate": "2023-01-01T00:00:00.000Z",
          "endDate": null,
          "description": "…"
        }
      ]
    }
  ],
  "skills": [
    { "_id": "…", "category": "Frontend", "items": [{ "name": "React", "level": 95 }] }
  ],
  "projects": [
    {
      "_id": "…",
      "title": "Nimbus Analytics Dashboard",
      "description": "…",
      "details": "…",
      "technologies": ["React", "Node.js"],
      "githubLink": "https://…",
      "liveLink": "https://…",
      "image": "data:image/webp;base64,UklGRi…"
    }
  ],
  "generatedAt": "2026-07-02T10:15:00.000Z"
}
\`\`\`

Response headers also include:

| Header | Meaning |
|---|---|
| \`X-Cache: HIT\` | Served from KV without touching the backend. |
| \`X-Cache: MISS\` | Cache was cold; fetched live from the backend and repopulated KV. |
| \`X-Cache-Updated-At\` | ISO timestamp of when this cached payload was generated. |

### Response — 502 Bad Gateway

Returned if both the KV cache is empty/unreadable **and** the live
fallback fetch to the backend fails (e.g. Render is down).

\`\`\`json
{
  "message": "Failed to load portfolio data.",
  "error": "Backend responded with 503 Service Unavailable"
}
\`\`\`

### Example

\`\`\`bash
curl https://portfolio-middleware.<subdomain>.workers.dev/api/all
\`\`\`

---

## POST /api/contact

Accepts a contact-form submission from the public site and buffers it in
KV. It does **not** forward to the backend immediately — messages are
batched and flushed to Render every 6 hours (or manually via
\`/api/test-flush\`), so the visitor's request returns instantly without
waiting on Render.

**Method:** \`POST\`
**Auth:** none
**Content-Type:** \`application/json\`

### Request Body

\`\`\`json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "message": "Loved your portfolio, let's talk!"
}
\`\`\`

| Field | Type | Required | Notes |
|---|---|---|---|
| \`name\` | string | yes | Trimmed; rejected if empty after trim. |
| \`email\` | string | yes | Trimmed; validated against a standard email regex. |
| \`message\` | string | yes | Trimmed; rejected if empty after trim. |

### Response — 201 Created

\`\`\`json
{ "message": "Message received successfully." }
\`\`\`

### Response — 400 Bad Request

\`\`\`json
{ "message": "Name, email and message are all required." }
\`\`\`
\`\`\`json
{ "message": "Please provide a valid email address." }
\`\`\`

### Response — 502 Bad Gateway

Returned only if the KV write itself fails (rare — not related to the
backend, since nothing is forwarded synchronously).

\`\`\`json
{ "message": "Failed to store your message. Please try again.", "error": "…" }
\`\`\`

### Example

\`\`\`bash
curl -X POST https://portfolio-middleware.<subdomain>.workers.dev/api/contact \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Jane Doe","email":"jane@example.com","message":"Hi there!"}'
\`\`\`

---

## POST /api/refresh  🔒 Protected

Pulls fresh data from the backend's \`GET {BACKEND_URL}/all\` and overwrites
the KV cache. Called automatically:

- Every 5 minutes by the Worker's own Cron Trigger.
- Immediately by the Render backend after any admin create/update/delete,
  so the public cache doesn't have to wait for the next cron tick.

**Method:** \`POST\`
**Auth:** required — \`x-refresh-secret\` header or \`?secret=\` query param,
matching the Worker's \`REFRESH_SECRET\` binding.

### Request

No body required.

\`\`\`bash
curl -X POST "https://portfolio-middleware.<subdomain>.workers.dev/api/refresh" \\
  -H "x-refresh-secret: <REFRESH_SECRET>"
\`\`\`

or

\`\`\`bash
curl -X POST "https://portfolio-middleware.<subdomain>.workers.dev/api/refresh?secret=<REFRESH_SECRET>"
\`\`\`

### Response — 200 OK

\`\`\`json
{ "success": true, "updatedAt": "2026-07-02T10:15:00.000Z" }
\`\`\`

### Response — 401 Unauthorized

\`\`\`json
{ "message": "Unauthorized." }
\`\`\`

### Response — 502 Bad Gateway

Returned if the live fetch to the backend fails.

\`\`\`json
{ "success": false, "message": "Backend responded with 503 Service Unavailable" }
\`\`\`

---

## POST /api/test-flush  (manual trigger for debugging)

Manually runs the same "flush buffered contact messages to the backend"
job that otherwise only runs on the 6-hour Cron Trigger. Useful for
testing the contact-form pipeline without waiting for the schedule.

**Method:** \`POST\`
**Auth:** none *(consider adding the same \`x-refresh-secret\` protection
before using this in production — it is currently open)*

### Response — 200 OK

\`\`\`json
{ "flushed": 3, "remaining": 0 }
\`\`\`

| Field | Meaning |
|---|---|
| \`flushed\` | Number of buffered messages successfully POSTed to the backend and removed from KV. |
| \`remaining\` | Number of messages that failed to send and are still buffered for the next attempt. |

---

## Everything else → 404

Any path not listed above returns:

\`\`\`json
{ "message": "Not found. This worker only serves /api/all, /api/contact and /api/refresh." }
\`\`\`

This includes admin login, admin CRUD, and the admin message inbox — the
frontend calls the Render backend directly for all of that (see the
Worker's own \`README.md\` and the frontend's \`src/api/axios.js\` vs
\`src/api/dataApi.js\` for which client is used where).

---

## Scheduled Jobs (not HTTP-triggered)

| Cron | Handler | Purpose |
|---|---|---|
| \`*/5 * * * *\` | \`refreshCache()\` | Keeps \`/api/all\`'s KV cache warm every 5 minutes. |
| \`0 */6 * * *\` | \`flushPendingContacts()\` | Batch-sends buffered contact messages to the backend every 6 hours. |

---

## Environment Bindings Reference

| Binding | Type | Used by |
|---|---|---|
| \`PORTFOLIO_KV\` | KV Namespace | All routes — stores \`portfolio:all\` and \`portfolio:pending-contacts\`. |
| \`BACKEND_URL\` | Secret/Var | \`/api/all\` (fallback), \`/api/refresh\`, \`/api/test-flush\`, scheduled jobs — the Render backend's base API URL, e.g. \`https://portfolio-api-1yjf.onrender.com/api\`. |
| \`REFRESH_SECRET\` | Secret | \`/api/refresh\` — shared secret, must match the backend's \`REFRESH_SECRET\` env var. |
| \`ALLOWED_ORIGIN\` | Var | All routes — CORS allow-list. |
`;
