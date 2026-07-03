import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { proxyToBackend } from '../lib/proxy.js';

const skillSchema = z.object({
  _id: z.string(),
  category: z.string(),
  items: z.array(z.object({ name: z.string(), level: z.number().optional() })),
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

export class ListSkills extends OpenAPIRoute {
  schema = {
    tags: ['Skill'],
    summary: 'List all skill categories',
    description: 'Proxies straight through to the backend\'s GET /skills. No admin auth required.',
    responses: {
      '200': { description: 'Array of skill categories.', content: { 'application/json': { schema: z.array(skillSchema) } } },
    },
  };
  async handle(c) {
    return proxyToBackend(c, '/skills');
  }
}

export class CreateSkill extends OpenAPIRoute {
  schema = {
    tags: ['Skill'],
    summary: 'Create a skill category',
    description: 'Proxies straight through to the backend\'s POST /skills.',
    parameters: [adminHeader],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              category: z.string(),
              items: z.array(z.object({ name: z.string(), level: z.number().optional() })),
              order: z.number().optional(),
            }),
          },
        },
      },
    },
    responses: {
      '201': { description: 'Created skill category.', content: { 'application/json': { schema: skillSchema } } },
      '401': { description: 'Missing/invalid admin token.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    return proxyToBackend(c, '/skills');
  }
}

export class UpdateSkill extends OpenAPIRoute {
  schema = {
    tags: ['Skill'],
    summary: 'Update a skill category',
    description: 'Proxies straight through to the backend\'s PUT /skills/{id}.',
    parameters: [
      adminHeader,
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              category: z.string().optional(),
              items: z.array(z.object({ name: z.string(), level: z.number().optional() })).optional(),
              order: z.number().optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Updated skill category.', content: { 'application/json': { schema: skillSchema } } },
      '404': { description: 'Skill category not found.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    const { id } = c.req.param();
    return proxyToBackend(c, `/skills/${id}`);
  }
}

export class DeleteSkill extends OpenAPIRoute {
  schema = {
    tags: ['Skill'],
    summary: 'Delete a skill category',
    description: 'Proxies straight through to the backend\'s DELETE /skills/{id}.',
    parameters: [
      adminHeader,
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      '200': { description: 'Deleted.', content: { 'application/json': { schema: errorSchema } } },
      '404': { description: 'Skill category not found.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    const { id } = c.req.param();
    return proxyToBackend(c, `/skills/${id}`);
  }
}
