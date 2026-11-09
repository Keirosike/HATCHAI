import test from 'node:test';
import assert from 'node:assert/strict';
import { readIncubators } from '../public/incubator-read.js';

test('uses signed-in read-only request and returns only display fields', async () => {
  const rows = await readIncubators('test-session', async (url, options) => {
    assert.equal(url, 'https://hatchai.kurtzidrickguno-robles.workers.dev/online/incubators');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer test-session');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.apikey, undefined);
    return Response.json({ incubators: [{ id: 'record', device_name: 'HATCHAI', device_id: 'controller', extra: 'discard' }] });
  });
  assert.deepEqual(rows, [{ id: 'record', device_name: 'HATCHAI', device_id: 'controller' }]);
});
test('empty RLS result is not reported as a registered incubator', async () => {
  assert.deepEqual(await readIncubators('test', async () => Response.json({ incubators: [] })), []);
});
test('local Worker adapter uses only authorization and unwraps owned records', async () => {
  const rows = await readIncubators('synthetic-token', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8787/online/incubators');
    assert.equal(options.headers.apikey, undefined);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return Response.json({ incubators: [{ id: 'record', device_name: 'HATCHAI', device_id: 'controller' }], monitoringConnected: false });
  }, true);
  assert.equal(rows.length, 1);
});
test('local error reporting distinguishes HTTP rejection, network failure and timeout safely', async () => {
  for (const code of [401, 403, 503]) {
    await assert.rejects(readIncubators('synthetic', async () => new Response('private-detail', { status: code }), true),
      error => error.message.includes(`HTTP ${code}`) && !error.message.includes('private-detail'));
  }
  await assert.rejects(readIncubators('synthetic', async () => { throw new TypeError('private-network-detail'); }, true), /Cannot reach the local Worker/);
  await assert.rejects(readIncubators('synthetic', async () => { throw new DOMException('private-detail', 'AbortError'); }, true), /Local Worker lookup timed out/);
});
test('denied, oversized and malformed responses fail without leaking response bodies', async () => {
  for (const response of [new Response('private-provider-detail', { status: 403 }),
    new Response('x'.repeat(17000)), Response.json({ invalid: true }), Response.json([{ id: 1 }])]) {
    await assert.rejects(readIncubators('test', async () => response), error =>
      (error.message.startsWith('Unable to load your incubator.') || error.message.startsWith('The Worker returned a malformed') || error.message.startsWith('Incubator lookup failed (HTTP 403)')) && !error.message.includes('private-provider-detail'));
  }
});
test('deployed network and timeout failures have safe distinct messages', async () => {
  await assert.rejects(readIncubators('synthetic', async () => { throw new TypeError('private-details'); }),
    error => error.message.includes('Cannot reach the deployed Worker') && !error.message.includes('private-details'));
  await assert.rejects(readIncubators('synthetic', async () => { throw new DOMException('private-details', 'AbortError'); }),
    /deployed Worker lookup timed out/);
});
test('malformed deployed response cannot become a success', async () => {
  for (const response of [new Response('{private-details'), Response.json({ incubators: [{ id: 'only-id' }] }), Response.json([])]) {
    await assert.rejects(readIncubators('synthetic', async () => response), error =>
      error.message.includes('malformed incubator response') && !error.message.includes('private-details'));
  }
});
test('503 stage reporting uses only fixed allowlisted labels', async () => {
  for (const [label, expected] of [['User authentication unavailable', 'session verification'],
    ['Incubator lookup unavailable', 'ownership validation'], ['private-secret-details', 'could not complete']]) {
    await assert.rejects(readIncubators('synthetic', async () => Response.json({ error: label }, { status: 503 })),
      error => error.message.includes(expected) && !error.message.includes('private-secret-details'));
  }
});
