import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { refreshCache, KEYS } from '../lib/kv.js';

export class FetchAll extends OpenAPIRoute {
  schema = {
    tags: ['Portfolio'],
    summary: 'Get the full portfolio payload',
    description:
      'Serves the merged portfolio JSON (profile, experience, skills, projects) out of the Cloudflare KV ' +
      'cache, so visitors never wait on a possibly-sleeping Render instance. On a cold cache it fetches live ' +
      "from the backend's own /all endpoint once, populates KV, and serves that instead. Requires the " +
      'shared bearer token like every other route here (this used to be open — it no longer is).',
    responses: {
      '200': {
        description: 'Portfolio data — check the X-Cache header to see if it was a cache HIT or MISS.',
        content: {
          'application/json': {
            schema: z.object({
              profile: z.record(z.any()),
              experience: z.array(z.any()),
              skills: z.array(z.any()),
              projects: z.array(z.any()),
              generatedAt: z.string(),
            }),
          },
        },
      },
      '502': {
        description: 'Both the KV cache and the live fallback fetch to the backend failed.',
        content: {
          'application/json': {
            schema: z.object({ message: z.string(), error: z.string() }),
          },
        },
      },
    },
  };

  async handle(c) {
    try {
      const cachedRaw = await c.env.PORTFOLIO_KV.get(KEYS.DATA_KEY);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        return c.json(cached.data, 200, {
          'X-Cache': 'HIT',
          'X-Cache-Updated-At': cached.updatedAt,
        });
      }

      const fresh = await refreshCache(c.env);
      return c.json(fresh.data, 200, {
        'X-Cache': 'MISS',
        'X-Cache-Updated-At': fresh.updatedAt,
      });
    } catch (err) {
      return c.json({ message: 'Failed to load portfolio data.', error: err.message }, 502);
    }
  }
}
