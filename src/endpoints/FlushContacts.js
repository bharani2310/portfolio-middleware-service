import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { flushPendingContacts } from '../lib/kv.js';

export class FlushContacts extends OpenAPIRoute {
  schema = {
    tags: ['Contact'],
    summary: 'Manually flush buffered contact messages to the backend',
    description:
      'Runs the same job that otherwise only fires on the 6-hour Cron Trigger — useful for testing the ' +
      'contact pipeline without waiting for the schedule, and it\'s also what the admin panel\'s "Refresh" ' +
      'button calls. Messages that fail to send stay buffered for the next attempt instead of being lost. ' +
      'Requires the shared bearer token like every other route here.',
    responses: {
      '200': {
        description: 'Flush result.',
        content: {
          'application/json': { schema: z.object({ flushed: z.number(), remaining: z.number() }) },
        },
      },
    },
  };

  async handle(c) {
    const result = await flushPendingContacts(c.env);
    return c.json(result, 200);
  }
}
