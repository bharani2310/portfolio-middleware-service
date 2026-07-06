/**
 * Bearer-token authentication shared by every route in this worker.
 *
 * A single static token (the `API_TOKEN` secret) gates the entire API —
 * including GET /api/all, which used to be wide open. There's no
 * user/admin distinction at this layer: the frontend's public pages and
 * the admin panel both send the same token, since this worker only ever
 * decides "is this a legitimate client of the API at all", not "who is
 * this person" (that's still the backend's job via its own JWT admin
 * auth, which this worker just forwards untouched when proxying).
 *
 * The docs UI (GET /api/docs) and the raw OpenAPI spec are deliberately
 * left token-free so people can read the documentation, click "Authorize"
 * and try the token there — the exact same UX as any Swagger-documented,
 * bearer-protected API.
 */

const encoder = new TextEncoder();

/** Constant-time string comparison — avoids leaking the token via timing. */
function timingSafeEqual(a, b) {
  const bytesA = encoder.encode(a);
  const bytesB = encoder.encode(b);
  if (bytesA.length !== bytesB.length) return false;
  let diff = 0;
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

/** Extracts the bearer token from `Authorization: Bearer <token>`. */
export function extractBearerToken(c) {
  const header = c.req.header('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** True if the request carries a token matching the worker's API_TOKEN secret. */
export function isAuthorized(c) {
  const expected = c.env.API_TOKEN;
  if (!expected) return false;
  const provided = extractBearerToken(c);
  if (!provided) return false;
  return timingSafeEqual(provided, expected);
}

/** Paths that stay reachable without a token — the docs surface, plus
 * /api/refresh and /api/resume/refresh, which already have their own
 * dedicated x-refresh-secret protection (used by the backend's automated
 * post-write pings and, for /api/refresh only, by the Cron Trigger too)
 * and shouldn't require a second, different token on top of that.
 *
 * Note: chanfana serves the raw OpenAPI spec JSON at /openapi.json
 * (root-level), NOT /api/openapi.json — Swagger UI's own JS fetches that
 * path directly to render the docs page, so it must stay open too or the
 * docs page loads but shows nothing (exactly the 401 you'd see in the
 * browser console otherwise).
 */
export const PUBLIC_PATHS = ['/api/docs', '/openapi.json', '/api/refresh', '/api/resume/refresh'];

export function isPublicPath(path) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * The OpenAPI security scheme + global requirement, plugged into
 * `fromHono(app, { schema })` in index.js. This is what makes the
 * "Authorize" lock icon show up in Swagger UI, and makes every documented
 * operation show as requiring `bearerAuth`.
 */
export const securitySchema = {
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'User Token - The worker\'s shared API_TOKEN. Every route requires this, including GET requests.',
      },
      refreshSecret: {
        type: 'apiKey',
        in: 'header',
        name: 'x-refresh-secret',
        description:
          'Refresh Token - Only used by POST /api/refresh, which is called by the backend and by Cloudflare Cron rather ' +
          'than by end users, so it keeps its own separate shared secret instead of the bearer token above.',
      },
    },
  },
  security: [{ bearerAuth: [] }],
};

/**
 * Belt-and-suspenders fix: some chanfana/hono version combos don't merge
 * the `schema.components.securitySchemes` / `schema.security` passed to
 * `fromHono()` into the generated spec, which means the "Authorize"
 * button never appears in Swagger UI even though every route really is
 * bearer-protected. Rather than depend on that merge working, this
 * middleware patches the actual /openapi.json response after chanfana
 * generates it, guaranteeing the security scheme is present.
 */
export async function ensureSecuritySchemeMiddleware(c, next) {
  await next();
  if (c.req.path !== '/openapi.json' || !c.res) return;

  try {
    const body = await c.res.clone().json();
    body.components = body.components || {};
    body.components.securitySchemes = {
      ...(body.components.securitySchemes || {}),
      ...securitySchema.components.securitySchemes,
    };
    if (!body.security || body.security.length === 0) {
      body.security = securitySchema.security;
    }
    const headers = new Headers(c.res.headers);
    headers.set('Content-Type', 'application/json');
    c.res = new Response(JSON.stringify(body), { status: c.res.status, headers });
  } catch {
    // Spec wasn't JSON for some reason — leave the response untouched
    // rather than break the docs page entirely.
  }
}
