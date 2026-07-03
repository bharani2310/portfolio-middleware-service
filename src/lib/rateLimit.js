/**
 * Simple fixed-window, per-IP rate limiter backed by the same KV
 * namespace already used for caching. This is the actual abuse/cost
 * protection for this worker — unlike the bearer token (which only
 * proves "this client read the token from somewhere", not who they are),
 * this limits how much damage any single IP can do even if it has a
 * valid token, an invalid token, or no token at all.
 *
 * Deliberately runs BEFORE the auth check in index.js, so brute-forcing
 * the API_TOKEN itself is also throttled, not just legitimate traffic.
 *
 * Implementation notes:
 *   - Cloudflare sets CF-Connecting-IP at the edge; it can't be spoofed
 *     by the client (Cloudflare overwrites whatever the client sends).
 *   - KV is eventually-consistent and this counter isn't atomic, so under
 *     genuine burst concurrency from one IP the count can be slightly
 *     off. That's fine for this threat model (opportunistic bots/
 *     scrapers), not a substitute for a Durable-Object-based limiter if
 *     you ever need exact enforcement.
 *   - Defaults: 60 requests per 60-second window per IP. Override via the
 *     RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_SECONDS vars if needed.
 */

const DEFAULT_MAX = 60;
const DEFAULT_WINDOW_SECONDS = 60;

export async function checkRateLimit(c) {
  const ip = c.req.header('CF-Connecting-IP') || 'unknown';
  const max = Number(c.env.RATE_LIMIT_MAX) || DEFAULT_MAX;
  const windowSeconds = Number(c.env.RATE_LIMIT_WINDOW_SECONDS) || DEFAULT_WINDOW_SECONDS;

  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `ratelimit:${ip}:${bucket}`;

  let count = 0;
  try {
    const raw = await c.env.PORTFOLIO_KV.get(key);
    count = raw ? parseInt(raw, 10) : 0;
  } catch {
    // KV read failed — fail OPEN rather than blocking legitimate traffic
    // because of a transient storage issue.
    return { allowed: true, remaining: max };
  }

  if (count >= max) {
    return { allowed: false, remaining: 0, retryAfter: windowSeconds };
  }

  try {
    await c.env.PORTFOLIO_KV.put(key, String(count + 1), { expirationTtl: windowSeconds + 5 });
  } catch {
    // Write failed — let this request through rather than blocking on it.
  }

  return { allowed: true, remaining: max - (count + 1) };
}

export async function rateLimitMiddleware(c, next) {
  const result = await checkRateLimit(c);
  if (!result.allowed) {
    return c.json(
      { message: 'Too many requests. Please slow down and try again shortly.' },
      429,
      { 'Retry-After': String(result.retryAfter) }
    );
  }
  c.header('X-RateLimit-Remaining', String(result.remaining));
  return next();
}
