import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { proxyToBackend } from '../lib/proxy.js';

const projectSchema = z.object({
  _id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  details: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  githubLink: z.string().optional(),
  liveLink: z.string().optional(),
});
const errorSchema = z.object({ message: z.string() });
const adminHeader = {
  name: 'x-admin-token',
  in: 'header',
  required: true,
  description: "The backend admin JWT, forwarded as this proxy's Authorization header.",
  schema: { type: 'string' },
};

export class ListProjects extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'List all projects',
    description: 'Proxies straight through to the backend\'s GET /projects. No admin auth required.',
    responses: {
      '200': { description: 'Array of projects.', content: { 'application/json': { schema: z.array(projectSchema) } } },
    },
  };
  async handle(c) {
    return proxyToBackend(c, '/projects');
  }
}

export class GetProject extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Get a single project',
    description: 'Proxies straight through to the backend\'s GET /projects/{id}.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': { description: 'Project.', content: { 'application/json': { schema: projectSchema } } },
      '404': { description: 'Project not found.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    const { id } = c.req.param();
    return proxyToBackend(c, `/projects/${id}`);
  }
}

export class GetProjectImage extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Get a project image',
    description: 'Proxies straight through to the backend\'s GET /projects/{id}/image.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    responses: {
      '200': { description: 'Image binary.' },
      '404': { description: 'No image set.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    const { id } = c.req.param();
    return proxyToBackend(c, `/projects/${id}/image`);
  }
}

export class CreateProject extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Create a project',
    description:
      'Proxies straight through to the backend\'s POST /projects. multipart/form-data body (for the project ' +
      'image) is forwarded unparsed.',
    parameters: [adminHeader],
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              title: z.string(),
              description: z.string().optional(),
              details: z.string().optional(),
              technologies: z.string().optional().describe('Comma-separated list.'),
              githubLink: z.string().optional(),
              liveLink: z.string().optional(),
              image: z.string().optional().describe('Optional project image file.'),
            }),
          },
        },
      },
    },
    responses: {
      '201': { description: 'Created project.', content: { 'application/json': { schema: projectSchema } } },
      '401': { description: 'Missing/invalid admin token.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    return proxyToBackend(c, '/projects');
  }
}

export class UpdateProject extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Update a project',
    description: 'Proxies straight through to the backend\'s PUT /projects/{id}. multipart/form-data forwarded unparsed.',
    parameters: [
      adminHeader,
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              title: z.string().optional(),
              description: z.string().optional(),
              details: z.string().optional(),
              technologies: z.string().optional(),
              githubLink: z.string().optional(),
              liveLink: z.string().optional(),
              image: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Updated project.', content: { 'application/json': { schema: projectSchema } } },
      '404': { description: 'Project not found.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    const { id } = c.req.param();
    return proxyToBackend(c, `/projects/${id}`);
  }
}

export class DeleteProject extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Delete a project',
    description: 'Proxies straight through to the backend\'s DELETE /projects/{id}.',
    parameters: [
      adminHeader,
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ],
    responses: {
      '200': { description: 'Deleted.', content: { 'application/json': { schema: errorSchema } } },
      '404': { description: 'Project not found.', content: { 'application/json': { schema: errorSchema } } },
    },
  };
  async handle(c) {
    const { id } = c.req.param();
    return proxyToBackend(c, `/projects/${id}`);
  }
}
