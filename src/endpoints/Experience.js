import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { proxyToBackend } from '../lib/proxy.js';

const roleSchema = z.object({
  role: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  description: z.string().optional(),
});
const experienceSchema = z.object({
  _id: z.string(),
  companyName: z.string(),
  roles: z.array(roleSchema),
  technologies: z.array(z.string()).optional(),
  order: z.number().optional(),
});
const errorSchema = z.object({ message: z.string() });
const adminHeader = {
  name: 'x-admin-token',
  in: 'header',
  required: true,
  description: "The backend admin JWT, forwarded as this proxy's Authorization header.",
  schema: { type: 'string' },
};

export class ListExperience extends OpenAPIRoute {
  schema = {
    tags: ['Experience'],
    summary: 'List all experience entries',
    description: 'Proxies straight through to the backend\'s GET /experience. No admin auth required.',
    responses: {
      '200': { description: 'Array of experience entries.', content: { 'application/json': { schema: z.array(experienceSchema) } } },
    },
  };
  async handle(c) {
    return proxyToBackend(c, '/experience');
  }
}

export class CreateExperience extends OpenAPIRoute {
  schema = {
    tags: ['Experience'],
    summary: 'Create an experience entry',
    description: 'Proxies straight through to the backend\'s POST /experience.',
    parameters: [adminHeader],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              companyName: z.string(),
              roles: z.array(roleSchema),
              technologies: z.array(z.string()).optional(),
              order: z.number().optional(),
            }),
          },
        },
      },
    },
    responses: {
      '201': { description: 'Created experience entry.', content: { 'application/json': { schema: experienceSchema } } },
      '401': { description: 'Missing/invalid admin token.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    return proxyToBackend(c, '/experience');
  }
}

export class UpdateExperience extends OpenAPIRoute {
  schema = {
    tags: ['Experience'],
    summary: 'Update an experience entry',
    description: 'Proxies straight through to the backend\'s PUT /experience/{id}.',
    parameters: [
      adminHeader,
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              companyName: z.string().optional(),
              roles: z.array(roleSchema).optional(),
              technologies: z.array(z.string()).optional(),
              order: z.number().optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Updated experience entry.', content: { 'application/json': { schema: experienceSchema } } },
      '404': { description: 'Experience entry not found.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    const { id } = c.req.param();
    return proxyToBackend(c, `/experience/${id}`);
  }
}

export class DeleteExperience extends OpenAPIRoute {
  schema = {
    tags: ['Experience'],
    summary: 'Delete an experience entry',
    description: 'Proxies straight through to the backend\'s DELETE /experience/{id}.',
    parameters: [
      adminHeader,
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      '200': { description: 'Deleted.', content: { 'application/json': { schema: errorSchema } } },
      '404': { description: 'Experience entry not found.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    const { id } = c.req.param();
    return proxyToBackend(c, `/experience/${id}`);
  }
}
