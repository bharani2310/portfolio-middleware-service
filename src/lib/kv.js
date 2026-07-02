const DATA_KEY = 'portfolio:all';
const PENDING_CONTACTS_KEY = 'portfolio:pending-contacts';

/** Calls the Render backend's own aggregate endpoint. */
export async function fetchAllFromBackend(env) {
  if (!env.BACKEND_URL) {
    throw new Error('BACKEND_URL is not configured.');
  }
  const res = await fetch(`${env.BACKEND_URL}/all`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Backend responded with ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Fetches fresh data from the backend and overwrites the KV cache. */
export async function refreshCache(env) {
  const data = await fetchAllFromBackend(env);
  const payload = { data, updatedAt: new Date().toISOString() };
  await env.PORTFOLIO_KV.put(DATA_KEY, JSON.stringify(payload));
  return payload;
}

/** Reads the buffered (not-yet-sent-to-backend) contact messages from KV. */
export async function getPendingContacts(env) {
  const raw = await env.PORTFOLIO_KV.get(PENDING_CONTACTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function savePendingContacts(env, list) {
  if (!list.length) {
    await env.PORTFOLIO_KV.delete(PENDING_CONTACTS_KEY);
    return;
  }
  await env.PORTFOLIO_KV.put(PENDING_CONTACTS_KEY, JSON.stringify(list));
}

/**
 * POSTs every buffered message to the backend's public /contact endpoint
 * one at a time. Messages that succeed are dropped; messages that fail
 * (e.g. Render was briefly down) are kept in KV so they're retried on the
 * next tick instead of being lost.
 */
export async function flushPendingContacts(env) {
  const pending = await getPendingContacts(env);
  if (!pending.length) {
    return { flushed: 0, remaining: 0 };
  }
  if (!env.BACKEND_URL) {
    throw new Error('BACKEND_URL is not configured.');
  }

  const stillPending = [];
  let flushed = 0;

  for (const message of pending) {
    try {
      const res = await fetch(`${env.BACKEND_URL}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: message.name,
          email: message.email,
          message: message.message,
        }),
      });
      if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
      flushed += 1;
    } catch (err) {
      console.error('Failed to flush contact message, will retry next cycle:', err.message);
      stillPending.push(message);
    }
  }

  await savePendingContacts(env, stillPending);
  return { flushed, remaining: stillPending.length };
}

export function isAuthorizedRefresh(c) {
  const secret = c.env.REFRESH_SECRET;
  if (!secret) return false;
  const headerSecret = c.req.header('x-refresh-secret');
  const querySecret = c.req.query('secret');
  return (headerSecret || querySecret) === secret;
}

export const KEYS = { DATA_KEY, PENDING_CONTACTS_KEY };
