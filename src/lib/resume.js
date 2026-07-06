/**
 * Resume caching — deliberately separate from lib/kv.js's PORTFOLIO_KV.
 *
 * Unlike /api/all (proactively kept warm by a 5-minute Cron Trigger), the
 * resume cache is populated ONLY on demand:
 *   - Lazily, the first time a visitor requests GET /api/resume after a
 *     cold cache (nothing cached yet, or it was cleared).
 *   - Explicitly, when the backend calls POST /api/resume/refresh right
 *     after an admin uploads a new resume.
 * There is no Cron Trigger for this cache at all — see wrangler.toml.
 *
 * Storage: the PDF bytes go in RESUME_KV as raw binary under
 * RESUME_DATA_KEY; the content type + timestamp go in a small JSON value
 * under RESUME_META_KEY. Two keys instead of one so the (large) binary
 * value and the (tiny) metadata can be read/written independently.
 */

const RESUME_DATA_KEY = 'resume:data';
const RESUME_META_KEY = 'resume:meta';

/** Calls the backend's own resume endpoint directly (bypassing any cache). */
export async function fetchResumeFromBackend(env) {
  if (!env.BACKEND_URL) {
    throw new Error('BACKEND_URL is not configured.');
  }
  const res = await fetch(`${env.BACKEND_URL}/profile/resume`, {
    headers: { Accept: 'application/pdf' },
  });
  if (res.status === 404) {
    return null; // no resume uploaded on the backend (yet, or ever)
  }
  if (!res.ok) {
    throw new Error(`Backend responded with ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get('Content-Type') || 'application/pdf';
  const buffer = await res.arrayBuffer();
  return { buffer, contentType };
}

/** Reads the resume straight out of RESUME_KV. Returns null on a cache miss. */
export async function getResumeFromCache(env) {
  const metaRaw = await env.RESUME_KV.get(RESUME_META_KEY);
  if (!metaRaw) return null;

  let meta;
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    return null;
  }

  const buffer = await env.RESUME_KV.get(RESUME_DATA_KEY, 'arrayBuffer');
  if (!buffer) return null;

  return { buffer, contentType: meta.contentType, updatedAt: meta.updatedAt };
}

/**
 * Pulls the current resume from the backend and overwrites RESUME_KV. If
 * the backend has no resume at all (e.g. never uploaded, or somehow
 * removed), the cache is cleared to match rather than left stale.
 */
export async function refreshResumeCache(env) {
  const result = await fetchResumeFromBackend(env);

  if (!result) {
    await env.RESUME_KV.delete(RESUME_DATA_KEY);
    await env.RESUME_KV.delete(RESUME_META_KEY);
    return { cached: false };
  }

  const updatedAt = new Date().toISOString();
  await env.RESUME_KV.put(RESUME_DATA_KEY, result.buffer);
  await env.RESUME_KV.put(RESUME_META_KEY, JSON.stringify({ contentType: result.contentType, updatedAt }));
  return { cached: true, contentType: result.contentType, updatedAt };
}
