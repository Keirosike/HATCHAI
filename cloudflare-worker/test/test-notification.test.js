import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { prepareTestDelivery } from '../src/test-notification.js';

test('manual-test configuration fails closed without secrets and rejects non-project or invalid credentials', async () => {
  for (const env of [{}, { MANUAL_TEST_NOTIFICATIONS_ENABLED: 'true' },
    { MANUAL_TEST_NOTIFICATIONS_ENABLED: 'true', FCM_SERVICE_ACCOUNT_JSON: 'invalid-secret-value' },
    { MANUAL_TEST_NOTIFICATIONS_ENABLED: 'true', FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'another-project' }) }]) {
    await assert.rejects(prepareTestDelivery(env), error => error.status === 503 && !error.message.includes('invalid-secret-value'));
  }
});

test('service worker displays fixed manual content, avoids duplicate auto-display and ignores chick data', async () => {
  let handler; const displays = [], listeners = {};
  const scope = { location: { origin: 'https://hatchai-8d34c.web.app' },
    registration: { showNotification: async (title, options) => displays.push({ title, ...options }) },
    addEventListener: (name, callback) => { listeners[name] = callback; } };
  const opened = [];
  const context = vm.createContext({ importScripts() {}, URL, self: scope,
    firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage: cb => { handler = cb; } }) },
    clients: { matchAll: async () => [], openWindow: async url => opened.push(url) } });
  vm.runInContext(readFileSync(new URL('../../public/firebase-messaging-sw.js', import.meta.url), 'utf8'), context);
  await handler({ notification: { title: 'HATCHAI Test Notification' }, data: { type: 'hatchai-manual-test' } });
  assert.equal(displays.length, 0);
  await handler({ data: { type: 'chick-detected' } });assert.equal(displays.length, 0);
  await handler({ data: { type: 'hatchai-manual-test', title: 'Injected', body: 'Injected', url: 'https://evil.invalid' } });
  assert.equal(displays[0].title, 'HATCHAI Test Notification');
  assert.equal(displays[0].body, 'Your HATCHAI notification system is working.');
  let completion;
  listeners.notificationclick({ notification: { close() {}, data: { url: 'https://evil.invalid' } }, waitUntil: p => { completion = p; } });
  await completion;assert.deepEqual(opened, ['https://hatchai-8d34c.web.app/']);
});
