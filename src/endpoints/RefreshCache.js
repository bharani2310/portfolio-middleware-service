import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { refreshCache, isAuthorizedRefresh } from '../lib/kv.js';

export class RefreshCache extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Force-refresh the KV cache from the backend',
    description:
      "Protected route. Pulls fresh data from the Render backend's own /all endpoint and overwrites the KV " +
      'cache. Called automatically every 5 minutes by a Cron Trigger, and by the backend itself right after ' +
      'any admin create/update/delete so the public cache never has to wait for the next tick. ' +
      'Unlike every other route in this API, this one is intentionally exempt from the global bearer-token ' +
      'requirement — it uses its own x-refresh-secret instead, since it\'s only ever called by the backend ' +
      'and by Cloudflare Cron, never by a browser.',
    security: [{ refreshSecret: [] }],
    parameters: [
      {
        name: 'x-refresh-secret',
        in: 'header',
        required: false,
        description: 'Shared secret. Required unless passed as ?secret= instead.',
        schema: { type: 'string' },
      },
      {
        name: 'secret',
        in: 'query',
        required: false,
        description: 'Alternative to the x-refresh-secret header.',
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': {
        description: 'Cache refreshed successfully.',
        content: {
          'application/json': { schema: z.object({ success: z.boolean(), updatedAt: z.string() }) },
        },
      },
      '401': {
        description: 'Missing or incorrect secret.',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
      '502': {
        description: 'The live fetch to the backend failed.',
        content: {
          'application/json': { schema: z.object({ success: z.boolean(), message: z.string() }) },
        },
      },
    },
  };

  async handle(c) {
    if (!isAuthorizedRefresh(c)) {
      return c.json({ message: 'Unauthorized.' }, 401);
    }
    try {
      const result = await refreshCache(c.env);
      return c.json({ success: true, updatedAt: result.updatedAt }, 200);
    } catch (err) {
      return c.json({ success: false, message: err.message }, 502);
    }
  }
}
