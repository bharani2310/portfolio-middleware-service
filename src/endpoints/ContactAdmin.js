import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { proxyToBackend } from '../lib/proxy.js';

const messageSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string(),
  message: z.string(),
  read: z.boolean().optional(),
  createdAt: z.string().optional(),
});
const errorSchema = z.object({ message: z.string() });
const adminHeader = {
  name: 'x-admin-token',
  in: 'header',
  required: true,
  description: "The backend admin JWT, forwarded as this proxy's Authorization header.",
  schema: { type: 'string' },
};

export class ListMessages extends OpenAPIRoute {
  schema = {
    tags: ['Contact'],
    summary: 'List contact messages (admin inbox)',
    description:
      'Proxies straight through to the backend\'s GET /contact. Only shows messages already flushed from ' +
      'this worker\'s KV buffer — see POST /api/message-refresh to flush on demand.',
    parameters: [adminHeader],
    responses: {
      '200': { description: 'Array of messages.', content: { 'application/json': { schema: z.array(messageSchema) } } },
      '401': { description: 'Missing/invalid admin token.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    return proxyToBackend(c, '/contact');
  }
}

export class DeleteMessage extends OpenAPIRoute {
  schema = {
    tags: ['Contact'],
    summary: 'Delete a single message',
    description: 'Proxies straight through to the backend\'s DELETE /contact/{id}.',
    parameters: [
      adminHeader,
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      '200': { description: 'Deleted.', content: { 'application/json': { schema: errorSchema } } },
      '404': { description: 'Message not found.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    const { id } = c.req.param();
    return proxyToBackend(c, `/contact/${id}`);
  }
}

export class DeleteConversation extends OpenAPIRoute {
  schema = {
    tags: ['Contact'],
    summary: 'Delete an entire conversation by email',
    description: 'Proxies straight through to the backend\'s DELETE /contact/conversation/{email}.',
    parameters: [
      adminHeader,
      { name: 'email', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      '200': { description: 'Deleted.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    const { email } = c.req.param();
    return proxyToBackend(c, `/contact/conversation/${email}`);
  }
}

export class MarkConversationRead extends OpenAPIRoute {
  schema = {
    tags: ['Contact'],
    summary: 'Mark a conversation as read',
    description: 'Proxies straight through to the backend\'s PATCH /contact/conversation/{email}/read.',
    parameters: [
      adminHeader,
      { name: 'email', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      '200': { description: 'Marked as read.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    const { email } = c.req.param();
    return proxyToBackend(c, `/contact/conversation/${email}/read`);
  }
}
