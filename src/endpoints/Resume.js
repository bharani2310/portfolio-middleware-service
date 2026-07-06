import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { getResumeFromCache, refreshResumeCache, fetchResumeFromBackend } from '../lib/resume.js';
import { isAuthorizedRefresh } from '../lib/kv.js';

const errorSchema = z.object({ message: z.string() });

export class GetResume extends OpenAPIRoute {
  schema = {
    tags: ['Resume'],
    summary: 'Get the resume PDF',
    description:
      'Serves the resume out of a dedicated KV cache (RESUME_KV — separate from the main portfolio-data ' +
      'cache used by GET /api/all). This cache has NO periodic Cron Trigger: it is populated lazily on the ' +
      'first request after a cold cache, and explicitly refreshed by POST /api/resume/refresh right after an ' +
      'admin uploads a new resume. Pass ?download=1 to receive it as an attachment instead of inline.',
    parameters: [
      {
        name: 'download',
        in: 'query',
        required: false,
        description: 'Set to any truthy value to force a download instead of an inline view.',
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': { description: 'The resume PDF.' },
      '404': { description: 'No resume has been uploaded yet.', content: { 'application/json': { schema: errorSchema } } },
      '502': { description: 'Backend unreachable while populating a cold cache.', content: { 'application/json': { schema: errorSchema } } },
    },
  };

  async handle(c) {
    let resume = await getResumeFromCache(c.env);

    if (!resume) {
      // Cold cache — this is the "only serve from KV if the user actually
      // requests it" lazy-population path, not a background job.
      try {
        const fresh = await fetchResumeFromBackend(c.env);
        if (!fresh) {
          return c.json({ message: 'No resume has been uploaded yet.' }, 404);
        }
        await c.env.RESUME_KV.put('resume:data', fresh.buffer);
        await c.env.RESUME_KV.put(
          'resume:meta',
          JSON.stringify({ contentType: fresh.contentType, updatedAt: new Date().toISOString() })
        );
        resume = fresh;
      } catch (err) {
        return c.json({ message: 'Failed to load resume.', error: err.message }, 502);
      }
    }

    const disposition = c.req.query('download') ? 'attachment' : 'inline';
    return new Response(resume.buffer, {
      status: 200,
      headers: {
        'Content-Type': resume.contentType,
        'Content-Disposition': `${disposition}; filename="resume.pdf"`,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
}

export class RefreshResume extends OpenAPIRoute {
  schema = {
    tags: ['Resume'],
    summary: 'Force-refresh the resume KV cache from the backend',
    description:
      'Pulls the current resume from the backend and overwrites RESUME_KV. Called automatically by the ' +
      'backend right after an admin uploads a new resume — there is no Cron Trigger for this, unlike ' +
      'POST /api/refresh. Uses the same x-refresh-secret as that route rather than the shared bearer token, ' +
      'since this is only ever called server-to-server, never from a browser.',
    security: [{ refreshSecret: [] }],
    responses: {
      '200': { description: 'Resume cache refreshed (or cleared, if the backend has no resume).' },
      '401': { description: 'Missing/invalid refresh secret.', content: { 'application/json': { schema: errorSchema } } },
      '502': { description: 'Backend unreachable.', content: { 'application/json': { schema: errorSchema } } },
    },
  };

  async handle(c) {
    if (!isAuthorizedRefresh(c)) {
      return c.json({ message: 'Unauthorized.' }, 401);
    }
    try {
      const result = await refreshResumeCache(c.env);
      return c.json({ success: true, ...result });
    } catch (err) {
      return c.json({ message: 'Failed to refresh resume cache.', error: err.message }, 502);
    }
  }
}
