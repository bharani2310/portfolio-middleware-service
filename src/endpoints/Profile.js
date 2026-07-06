import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import { proxyToBackend } from '../lib/proxy.js';

const profileSchema = z.object({
  _id: z.string(),
  name: z.string(),
  role: z.string(),
  description: z.string().optional(),
  professionalSummary: z.string().optional(),
  currentCompany: z.string().optional(),
  location: z.string().optional(),
  resumeFile: z.string().nullable().optional().describe('URL for the uploaded resume, or null if none uploaded. See the Resume tag for the actual serving/caching route.'),
  socialLinks: z.record(z.string()).optional(),
});

const errorSchema = z.object({ message: z.string() });

export class GetProfile extends OpenAPIRoute {
  schema = {
    tags: ['Profile'],
    summary: 'Get the profile',
    description: 'Proxies straight through to the backend\'s GET /profile. No admin auth required.',
    responses: {
      '200': { description: 'Profile data.', content: { 'application/json': { schema: profileSchema } } },
      '502': { description: 'Backend unreachable.', content: { 'application/json': { schema: errorSchema } } },
    },
  };

  async handle(c) {
    return proxyToBackend(c, '/profile');
  }
}

export class GetProfileImage extends OpenAPIRoute {
  schema = {
    tags: ['Profile'],
    summary: 'Get the profile image',
    description: 'Proxies straight through to the backend\'s GET /profile/image.',
    responses: {
      '200': { description: 'Image binary.' },
      '404': { description: 'No profile image set.', content: { 'application/json': { schema: errorSchema } } },
    },
  };

  async handle(c) {
    return proxyToBackend(c, '/profile/image');
  }
}

export class UpdateProfile extends OpenAPIRoute {
  schema = {
    tags: ['Profile'],
    summary: 'Update the profile',
    description:
      'Proxies straight through to the backend\'s PUT /profile. Requires the backend admin JWT — pass it as ' +
      'the x-admin-token header (in addition to this worker\'s own bearer token). multipart/form-data body ' +
      '(for an optional new profile photo and/or an optional new resume PDF) is forwarded unparsed. ' +
      'Uploading a resume here also triggers POST /api/resume/refresh server-side, so the separate resume ' +
      'cache picks up the new file immediately — see the Resume tag.',
    parameters: [
      {
        name: 'x-admin-token',
        in: 'header',
        required: true,
        description: "The backend admin JWT (from POST {backend}/auth/login), forwarded as this proxy's Authorization header.",
        schema: { type: 'string' },
      },
    ],
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              name: z.string().optional(),
              role: z.string().optional(),
              description: z.string().optional(),
              professionalSummary: z.string().optional(),
              currentCompany: z.string().optional(),
              location: z.string().optional(),
              image: z.string().optional().describe('Optional new profile photo file.'),
              resume: z.string().optional().describe('Optional new resume PDF file, replacing any existing one.'),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Updated profile.', content: { 'application/json': { schema: profileSchema } } },
      '401': { description: 'Missing/invalid admin token.', content: { 'application/json': { schema: errorSchema } } },
    },
  };

  async handle(c) {
    return proxyToBackend(c, '/profile');
  }
}
