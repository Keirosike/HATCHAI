import test from 'node:test';
import assert from 'node:assert/strict';
import { onlineFetch } from '../src/online-api.js';
import worker from '../src/index.js';
import { readFileSync } from 'node:fs';
const id = '17275f94-f94b-4f89-b1c4-752edf099bc1';
const env = { SUPABASE_URL: 'https://dihufafcztqjuudjeqdm.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only_value' };
const authorization = 'Bearer ' + 'a'.repeat(40);
const request = (headers = {}, method = 'GET') => new Request('https://example.test/online/incubators', { method, headers });
test('verifies user before RLS lookup and removes ownership fields', async () => {
  let calls = 0;
  const response = await onlineFetch(request({ Authorization: authorization }), env, async (url, options) => {
    assert.equal(options.headers.Authorization, authorization);
    if (++calls === 1) { assert.match(url, /auth\/v1\/user$/); return Response.json({ id, role: 'authenticated' }); }
    assert.ok(url.includes('owner_id=eq.' + id));
    assert.equal(options.redirect, 'manual');
    return Response.json([{ id: 'record', owner_id: id, device_name: 'HATCHAI', device_id: 'controller' }]);
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { incubators: [{ id: 'record', device_name: 'HATCHAI', device_id: 'controller' }], monitoringConnected: false });
});
test('missing authentication and disallowed origins cannot perform lookups', async () => {
  for (const [headers, status] of [[{}, 401], [{ Origin: 'https://evil.test', Authorization: authorization }, 403]]) {
    assert.equal((await onlineFetch(request(headers), env, () => { throw new Error('must not fetch'); })).status, status);
  }
});
test('invalid Supabase session is rejected without exposing provider detail', async () => {
  const response = await onlineFetch(request({ Authorization: authorization }), env, async () => new Response('secret-detail', { status: 401 }));
  assert.equal(response.status, 401); assert.ok(!(await response.text()).includes('secret-detail'));
});
test('foreign ownership, malformed and oversized results fail closed', async () => {
  for (const data of [Response.json([{ owner_id: 'other' }]), Response.json({ invalid: true }), new Response('x'.repeat(17000))]) {
    let calls = 0;
    const response = await onlineFetch(request({ Authorization: authorization }), env, async () => ++calls === 1 ? Response.json({ id, role: 'authenticated' }) : data);
    assert.equal(response.status, 503);
  }
});
test('preflight allows only configured origins and read-only method', async () => {
  const headers = { Origin: 'http://127.0.0.1:8080', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' };
  assert.equal((await onlineFetch(request(headers, 'OPTIONS'), env)).status, 403);
  const response = await onlineFetch(request(headers, 'OPTIONS'), { ...env, ONLINE_ALLOWED_ORIGINS: headers.Origin });
  assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Origin'), headers.Origin);
});

test('secret and legacy service-role keys cannot be used as publishable configuration', async () => {
  for (const key of ['sb_secret_mock_never_valid', 'eyJ.mock.service_role', '', undefined]) {
    const response = await onlineFetch(request({ Authorization: authorization }), { ...env, SUPABASE_PUBLISHABLE_KEY: key }, () => {
      assert.fail('Invalid key configuration must not reach Supabase');
    });
    assert.equal(response.status, 503);
  }
});
test('expired and malformed tokens never reach database lookup', async () => {
  let calls = 0;
  const expired = await onlineFetch(request({ Authorization: authorization }), env, async () => {
    calls++; return new Response('expired-sensitive-detail', { status: 401 });
  });
  assert.equal(expired.status, 401); assert.equal(calls, 1);
  assert.equal((await onlineFetch(request({ Authorization: 'Bearer bad' }), env, () => assert.fail())).status, 401);
});
test('different authenticated user receives no records and cannot choose another owner', async () => {
  const other = '00000000-0000-4000-8000-000000000002'; let calls = 0;
  const response = await onlineFetch(request({ Authorization: authorization }), env, async url => {
    if (++calls === 1) return Response.json({ id: other, role: 'authenticated' });
    assert.ok(url.includes('owner_id=eq.' + other)); assert.ok(!url.includes(id));
    return Response.json([]);
  });
  assert.deepEqual((await response.json()).incubators, []);
  const injected = new Request('https://example.test/online/incubators?owner_id=' + id, { headers: { Authorization: authorization } });
  assert.equal((await onlineFetch(injected, env, () => assert.fail())).status, 400);
});
test('allowed origin does not replace authentication; errors preserve CORS and no-store', async () => {
  const response = await onlineFetch(request({ Origin: 'https://hatchai-8d34c.web.app' }), env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://hatchai-8d34c.web.app');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null);
});
test('Worker router exposes online endpoint and keeps detection disabled', async () => {
  assert.equal((await worker.fetch(request(), env)).status, 401);
  assert.equal((await worker.fetch(request({}, 'POST'), env)).status, 405);
  assert.equal((await worker.fetch(new Request('https://example.test/chick-detected', { method: 'POST' }), env)).status, 503);
  assert.equal((await worker.fetch(new Request('https://example.test/'), env)).status, 200);
});
test('prepared myhatchai origin preserves approved origins without granting authentication', async () => {
  const configuration = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  const configured = { ...env, ONLINE_ALLOWED_ORIGINS: configuration.vars.ONLINE_ALLOWED_ORIGINS };
  for (const origin of ['http://127.0.0.1:8080', 'https://hatchai-8d34c.web.app', 'https://myhatchai.web.app']) {
    const response = await onlineFetch(request({ Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' }, 'OPTIONS'), configured);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal((await onlineFetch(request({ Origin: origin }), configured)).status, 401);
  }
  assert.equal((await onlineFetch(request({ Origin: 'https://not-my-hatchai.example' }), configured)).status, 403);
});
