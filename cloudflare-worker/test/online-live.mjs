// Opt-in read-only integration. Never prints tokens, provider bodies or records.
import assert from 'node:assert/strict';
import worker from '../src/index.js';
const token = process.env.HATCHAI_SUPABASE_ACCESS_TOKEN;
const owner = process.env.HATCHAI_EXPECTED_USER_ID;
if (!token || !/^[0-9a-f-]{36}$/i.test(owner || '')) {
  console.error('SKIP: privately configure HATCHAI_SUPABASE_ACCESS_TOKEN and HATCHAI_EXPECTED_USER_ID.');
  process.exitCode = 2;
} else {
  const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    ONLINE_ALLOWED_ORIGINS: process.env.ONLINE_ALLOWED_ORIGINS };
  const origin = process.env.HATCHAI_TEST_ORIGIN || 'http://127.0.0.1:8080';
  const call = authorization => worker.fetch(new Request('http://localhost/online/incubators', {
    headers: { Origin: origin, ...(authorization ? { Authorization: authorization } : {}) }
  }), env);
  try {
    assert.equal(env.SUPABASE_URL, 'https://dihufafcztqjuudjeqdm.supabase.co');
    assert.match(env.SUPABASE_PUBLISHABLE_KEY || '', /^sb_publishable_[A-Za-z0-9_-]{8,200}$/);
    // Independently establish which user the supplied token actually identifies.
    const identity = await fetch(env.SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + token },
      redirect: 'error', signal: AbortSignal.timeout(8000)
    });
    assert.equal(identity.status, 200); assert.equal((await identity.json()).id, owner);
    const response = await call('Bearer ' + token);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.incubators.length, 1);
    assert.equal(body.incubators[0].device_id, 'hatchai-inc01-controller');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal((await call()).status, 401);
    assert.equal((await call('Bearer ' + 'invalidmock'.repeat(6))).status, 401);
    console.log('PASS: live identity, expected incubator, allowed-origin CORS, missing and invalid session checks. No writes performed.');
  } catch {
    console.error('HOLD: live verification failed; details suppressed. Check private session and non-secret configuration.');
    process.exitCode = 1;
  } finally { delete process.env.HATCHAI_SUPABASE_ACCESS_TOKEN; }
}
