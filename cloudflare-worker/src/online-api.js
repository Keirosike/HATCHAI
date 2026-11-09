import { supabaseSessionVerifier } from './supabase-session.js';
import { ApiError, need } from './security.js';

export async function onlineFetch(request, env, fetcher = globalThis.fetch.bind(globalThis)) {
  const origin = request.headers.get('Origin');
  const allowed = new Set(['https://hatchai-8d34c.web.app']);
  // Local development origins must be explicitly configured, never reflected.
  for (const value of (env.ONLINE_ALLOWED_ORIGINS || '').split(',')) {
    if (/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(value) || /^http:\/\/127\.0\.0\.1:\d+$/.test(value)) allowed.add(value);
  }
  const headers = { 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin && allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const json = (body, status = 200) => Response.json(body, { status, headers });
  try {
    need(!origin || allowed.has(origin), 403, 'Origin not allowed');
    const url = new URL(request.url);
    need(!url.search, 400, 'Query parameters are not supported');
    if (request.method === 'OPTIONS') {
      need(request.headers.get('Access-Control-Request-Method') === 'GET', 405, 'Method not allowed');
      const requested = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
      need(requested.every(x => x === 'authorization'), 400, 'Headers not allowed');
      return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Authorization' } });
    }
    need(request.method === 'GET', 405, 'Method not allowed');
    const authorization = request.headers.get('Authorization');
    const user = await supabaseSessionVerifier(env, fetcher)(authorization);
    // Forward the user's session to PostgREST: RLS remains enforced. No privileged key.
    const response = await fetcher(env.SUPABASE_URL + '/rest/v1/incubators?select=id,device_name,device_id,owner_id&owner_id=eq.' + user.id + '&limit=20', {
      // Workers supports manual/follow. Inspect and reject redirects ourselves;
      // never forward the user's bearer token to a redirect destination.
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization }
    });
    need(response.ok, 503, 'Incubator lookup unavailable');
    const reader = response.body?.getReader(); need(reader, 503, 'Incubator lookup unavailable');
    let size = 0; const chunks = [];
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 16384) { await reader.cancel(); throw new ApiError(503, 'Incubator lookup unavailable'); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const rows = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    need(Array.isArray(rows) && rows.length <= 20 && rows.every(row => row && row.owner_id === user.id &&
      ['id', 'device_name', 'device_id'].every(key => typeof row[key] === 'string' && row[key].length <= 256)), 503, 'Incubator lookup unavailable');
    return json({ incubators: rows.map(({ id, device_name, device_id }) => ({ id, device_name, device_id })), monitoringConnected: false });
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : 'Online service unavailable' }, error instanceof ApiError ? error.status : 503);
  }
}
