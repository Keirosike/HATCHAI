import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require(process.env.HATCHAI_MINIFLARE || 'miniflare');
const id = '00000000-0000-4000-8000-000000000001';
let upstreamCalls = 0; let redirect = false;
const options = {
  modulesRoot: fileURLToPath(new URL('../src/', import.meta.url)),
  modules: ['index.js', 'pairing.js', 'security.js', 'retention.js', 'test-notification.js', 'online-api.js', 'supabase-session.js'].map(name => ({
    type: 'ESModule', path: fileURLToPath(new URL('../src/' + name, import.meta.url))
  })),
  compatibilityDate: '2026-11-07',
  bindings: { SUPABASE_URL: 'https://dihufafcztqjuudjeqdm.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_mock_runtime_only' },
  outboundService: async request => {
    upstreamCalls++;
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://dihufafcztqjuudjeqdm.supabase.co');
    assert.equal(request.headers.get('Authorization'), 'Bearer ' + 'a'.repeat(40));
    if (url.pathname === '/auth/v1/user') return Response.json({ id, role: 'authenticated' });
    assert.equal(url.pathname, '/rest/v1/incubators');
    assert.equal(url.searchParams.get('owner_id'), 'eq.' + id);
    if (redirect) return new Response(null, { status: 302, headers: { Location: 'https://not-authorized.example/' } });
    return Response.json([{ id, owner_id: id, device_name: 'Mock incubator', device_id: 'mock-controller' }]);
  }
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
try {
  const send = () => mf.dispatchFetch('http://localhost/online/incubators', { headers: { Authorization: 'Bearer ' + 'a'.repeat(40) } });
  const response = await send();
  const body = await response.json();
  console.log('Isolated online runtime: status=' + response.status + ', upstreamCalls=' + upstreamCalls);
  assert.equal(response.status, 200);
  assert.equal(body.incubators.length, 1);
  assert.equal(body.incubators[0].device_id, 'mock-controller');
  assert.equal(body.incubators[0].owner_id, undefined);
  redirect = true;
  assert.equal((await send()).status, 503);
  assert.equal(upstreamCalls, 4);
  console.log('PASS: actual workerd authenticated retrieval and redirect refusal; fake upstream only.');
} finally { await mf.dispose(); }
