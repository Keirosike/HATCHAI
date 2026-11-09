import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/native-push/service-worker.js', import.meta.url), 'utf8');
function fixture() {
  const events = {}, displayed = [], opened = [];
  const self = { location: { origin: 'https://myhatchai.web.app' }, addEventListener: (name, fn) => { events[name] = fn; },
    registration: { showNotification: async (title, options) => displayed.push({ title, options }) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) } };
  vm.runInNewContext(source, { self, URL });
  async function push(payload) {
    const pending = [];
    events.push({ data: { text: () => JSON.stringify(payload), json: () => payload }, waitUntil: work => pending.push(work) });
    await Promise.all(pending);
  }
  return { events, displayed, opened, push };
}
for (const position of ['upper', 'lower']) test(position + ' content is fixed; event tag is independent', async () => {
  const f = fixture();await f.push({ type: 'hatchai-chick-detected', position, eventId: 'mock_event_12345678', batchName: 'Test batch', url: 'https://evil.example', title: 'Untrusted title' });
  assert.equal(f.displayed[0].title, 'HATCHAI — Hatched Chick Detected!');
  assert.ok(f.displayed[0].options.body.includes(position));
  assert.ok(f.displayed[0].options.tag.includes(position));
  assert.equal(f.displayed[0].options.data.url, '/online-login.html');
});
test('malformed, oversized and unrelated push messages are ignored', async () => {
  const f = fixture();
  for (const payload of [null, {}, { type: 'other' }, { type: 'hatchai-chick-detected', position: 'upper', eventId: 'bad' }, { huge: 'x'.repeat(3000) }]) await f.push(payload);
  f.events.push({ data: { text() { throw new Error('synthetic'); } }, waitUntil() { assert.fail(); } });
  assert.equal(f.displayed.length, 0);
});
test('notification click ignores foreign notification URLs', async () => {
  const f = fixture();let pending;
  f.events.notificationclick({ notification: { close() {}, data: { url: 'https://evil.example' } }, waitUntil: work => { pending = work; } });
  await pending;
  assert.deepEqual(f.opened, ['https://myhatchai.web.app/online-login.html']);
});
test('worker has no SDK, registration, caching or fetch interception', () => {
  assert.ok(!/importScripts\(|firebasejs|caches\.|\.register\(|addEventListener\(['"]fetch/.test(source));
});
