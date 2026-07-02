import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { getPendingContacts, savePendingContacts } from '../lib/kv.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class SubmitContact extends OpenAPIRoute {
  schema = {
    tags: ['Contact'],
    summary: 'Submit a contact-form message',
    description:
      'Buffers the message in KV instead of forwarding it to the backend immediately, so the visitor\'s ' +
      'request returns instantly without waiting on Render. Buffered messages are batch-flushed to the ' +
      'backend every 6 hours (see POST /api/test-flush to trigger a flush manually).',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              name: Str({ example: 'Jane Doe' }),
              email: Str({ example: 'jane@example.com' }),
              message: Str({ example: "Loved your portfolio, let's talk!" }),
            }),
          },
        },
      },
    },
    responses: {
      '201': {
        description: 'Message accepted and buffered.',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
      '400': {
        description: 'Missing or invalid fields.',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
      '502': {
        description: 'Failed to write the message to KV.',
        content: {
          'application/json': { schema: z.object({ message: z.string(), error: z.string() }) },
        },
      },
    },
  };

  async handle(c) {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ message: 'Invalid JSON body.' }, 400);
    }

    const name = (body.name || '').trim();
    const email = (body.email || '').trim();
    const message = (body.message || '').trim();

    if (!name || !email || !message) {
      return c.json({ message: 'Name, email and message are all required.' }, 400);
    }
    if (!EMAIL_RE.test(email)) {
      return c.json({ message: 'Please provide a valid email address.' }, 400);
    }

    try {
      const pending = await getPendingContacts(c.env);
      pending.push({ name, email, message, receivedAt: new Date().toISOString() });
      await savePendingContacts(c.env, pending);
      return c.json({ message: 'Message received successfully.' }, 201);
    } catch (err) {
      return c.json(
        { message: 'Failed to store your message. Please try again.', error: err.message },
        502
      );
    }
  }
}
