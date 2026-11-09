import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../data/js/authSession.js', import.meta.url), 'utf8');
function fixture(status) {
  const local = new Map(), session = new Map(); const calls = [];
  const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) });
  const scope = { window: { location: { pathname: '/index.html' } }, document: { addEventListener() {} },
    localStorage: storage(local), sessionStorage: storage(session), crypto: { randomUUID: () => 'synthetic-client' },
    URLSearchParams, setInterval() { return 1; }, clearInterval() {}, Date,
    fetch: async (url, options) => { calls.push([url, options]); return { ok: status === 200, status, json: async () => ({ message: 'Rejected by mock controller' }) }; } };
  scope.window.HatchStorage = { get: key => local.has(key) ? JSON.parse(local.get(key)) : null,
    set: (key, value) => local.set(key, JSON.stringify(value)), remove: key => local.delete(key) };
  vm.runInNewContext(source, scope);
  return { api: scope.window.HatchAuthSession, local, calls };
}
test('local login still requires successful controller response and uses existing form encoding', async () => {
  const f = fixture(200);
  const result = await f.api.start('test-user', 'synthetic-password');
  assert.equal(result.ok, true);
  assert.equal(f.calls[0][0], '/api/session/start');
  assert.equal(new URLSearchParams(f.calls[0][1].body).get('username'), 'test-user');
  assert.equal(new URLSearchParams(f.calls[0][1].body).get('password'), 'synthetic-password');
  assert.ok(f.local.has('hatchaiActiveSession'));
});
test('rejected local login does not install an authenticated local session', async () => {
  const f = fixture(401);
  assert.equal((await f.api.start('test-user', 'synthetic-password')).ok, false);
  assert.equal(f.local.has('hatchaiActiveSession'), false);
});
