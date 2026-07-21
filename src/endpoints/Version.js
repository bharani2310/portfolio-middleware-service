import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { refreshCache, KEYS } from '../lib/kv.js';

/**
 * GET /api/version
 *
 * Companion to FetchAll: returns ONLY the `updatedAt` timestamp of the
 * cached portfolio payload, never the payload itself. Meant to be called
 * by the frontend on every page load/refresh as a cheap "has anything
 * changed since I last cached this?" ping — a few bytes instead of the
 * full profile/experience/skills/projects blob.
 *
 * The frontend compares this against the version it stored alongside its
 * own localStorage cache (see usePortfolioData.js):
 *   - same version  -> keep serving the local cache, no /all fetch needed
 *   - different / no local version -> fetch /all for a fresh copy
 *
 * On a cold KV cache this populates it (same fallback FetchAll uses) so
 * the very first caller of either endpoint always gets a real timestamp
 * back instead of null.
 */
export class Version extends OpenAPIRoute {
  schema = {
    tags: ['Portfolio'],
    summary: "Get the portfolio cache's current version (updatedAt only)",
    description:
      'Returns just the timestamp of the cached /api/all payload, without the payload itself, so callers ' +
      'can cheaply check whether their own cached copy is stale before deciding to fetch the full data.',
    responses: {
      '200': {
        description: 'Current cache version.',
        content: {
          'application/json': { schema: z.object({ updatedAt: z.string() }) },
        },
      },
      '502': {
        description: 'Both the KV cache and the live fallback fetch to the backend failed.',
        content: {
          'application/json': { schema: z.object({ message: z.string(), error: z.string() }) },
        },
      },
    },
  };

  async handle(c) {
    try {
      const cachedRaw = await c.env.PORTFOLIO_KV.get(KEYS.DATA_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        return c.json({ updatedAt: cached.updatedAt }, 200);
      }

      const fresh = await refreshCache(c.env);
      return c.json({ updatedAt: fresh.updatedAt }, 200);
    } catch (err) {
      return c.json({ message: 'Failed to load cache version.', error: err.message }, 502);
    }
  }
}
