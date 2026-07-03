/**
 * Forwards the current request to the Render backend at
 * `${BACKEND_URL}${path}`, streaming the method, query string, headers
 * and body through as-is (this includes multipart/form-data image
 * uploads on profile/project routes — nothing here parses the body, it's
 * piped straight through).
 *
 * The incoming `Authorization` header is intentionally NOT forwarded — by
 * the time a request gets here it has already been verified as carrying
 * this worker's own `API_TOKEN`, which the backend knows nothing about.
 * Admin write routes (POST/PUT/DELETE) still require the backend's own
 * admin JWT; the frontend must send that separately as `x-admin-token`,
 * which this proxy DOES forward, so backend's `requireAdmin` middleware
 * keeps working unchanged.
 */
export async function proxyToBackend(c, backendPath) {
  if (!c.env.BACKEND_URL) {
    return c.json({ message: 'BACKEND_URL is not configured.' }, 502);
  }

  const incoming = new URL(c.req.url);
  const target = new URL(`${c.env.BACKEND_URL}${backendPath}${incoming.search}`);

  const headers = new Headers(c.req.raw.headers);
  headers.delete('host');
  headers.delete('authorization'); // this worker's token, not the backend's concern
  const adminToken = c.req.header('x-admin-token');
  if (adminToken) headers.set('Authorization', `Bearer ${adminToken}`);

  const hasBody = !['GET', 'HEAD'].includes(c.req.method);

  try {
    const res = await fetch(target.toString(), {
      method: c.req.method,
      headers,
      body: hasBody ? c.req.raw.body : undefined,
      duplex: hasBody ? 'half' : undefined,
    });

    const resHeaders = new Headers(res.headers);
    resHeaders.delete('content-encoding'); // avoid double-decoding by the Workers runtime
    return new Response(res.body, { status: res.status, headers: resHeaders });
  } catch (err) {
    return c.json({ message: 'Failed to reach the backend.', error: err.message }, 502);
  }
}
