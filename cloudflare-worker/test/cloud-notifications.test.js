import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudNotificationCore, detectionNotification, validateDetection } from '../src/cloud-notifications.js';
import { b64, hmacKey, signingMessage } from '../src/security.js';
const time = 1800000000;
const keys = b64(new Uint8Array(32).fill(9));
const env = { NOTIFICATION_EVENT_KEYS: JSON.stringify({ 'gateway-inc01': { v1: keys } }),
  NOTIFICATION_EVENT_SOURCES: JSON.stringify({ 'gateway-inc01': { enabled: true, role: 'gateway', incubatorId: 'inc01', cameraIds: ['cam-upper', 'cam-lower'] } }) };
function fixture() {
  const phones = new Map(), tokens = new Map(), seen = new Map(), nonces = new Set(), cooldown = new Map(), queue = [], history = [];
  const repository = {
    isMember: async (user, inc) => user === 'user1' && inc === 'inc01',
    async registerPhone(item) {
      const existing = tokens.get(item.token);
      if (existing && existing !== item.userId) return { conflict: true };
      phones.set(item.browserId, item);tokens.set(item.token, item.userId);return { stored: true };
    },
    async unregisterPhone(user, inc, browser) { if (phones.get(browser)?.userId === user) phones.delete(browser);return true; },
    async acceptEvent({ source, event, nonce, now }) {
      // Mock of one serialized PostgreSQL transaction, not a production adapter.
      if (source.incubatorId !== 'inc01' || event.batchId !== 'batch1' ||
          event.position !== (event.cameraId === 'cam-upper' ? 'upper' : 'lower')) return { unauthorized: true };
      const key = event.cameraId + ':' + event.eventId;
      if (nonces.has(nonce)) return { conflict: true };
      nonces.add(nonce);
      if (seen.has(key)) return seen.get(key) === JSON.stringify(event) ? { status: 'duplicate' } : { conflict: true };
      seen.set(key, JSON.stringify(event));history.push(event);
      if ((cooldown.get(event.cameraId) || 0) > now) return { status: 'cooldown' };
      cooldown.set(event.cameraId, now + 60);
      for (const phone of phones.values()) queue.push({ leaseId: 'lease-' + queue.length, event, token: phone.token, attempt: 1, expiresAt: now + 300 });
      return { status: 'accepted' };
    },
    async claimDelivery() { return queue.shift(); },
    async finishDelivery(id, result) { history.push({ id, ...result });return true; }
  };
  let sendResult = { outcome: 'accepted' };const sent = [];
  const core = cloudNotificationCore({ repository, now: () => time, limit: async () => true,
    authenticateUser: async token => token === 'valid-session' ? { id: 'user1' } : null,
    send: async (token, content) => { sent.push({ token, content });return sendResult; } });
  return { core, repository, phones, sent, history, setSend: result => { sendResult = result; } };
}
function event(position = 'upper', suffix = 'a') { return { cameraId: 'cam-' + position, position, batchId: 'batch1', eventId: suffix.repeat(24), detectedAt: time, type: 'chick_detected' }; }
async function envelope(value, nonce = 'n'.repeat(24)) {
  const body = { deviceId: 'gateway-inc01', keyId: 'v1', issuedAt: time, nonce, event: value };
  body.signature = b64(await crypto.subtle.sign('HMAC', await hmacKey(keys), await signingMessage('/chick-detected', body)));return body;
}
const phone = { incubatorId: 'inc01', browserId: 'phone1', token: 'public-test-token-'.repeat(4), deviceName: 'test' };

test('Upper and Lower events notify the same authorized phone independently', async () => {
  const f = fixture();await f.core.register('valid-session', phone);
  await Promise.all([f.core.ingest(env, await envelope(event())), f.core.ingest(env, await envelope(event('lower'), 'l'.repeat(24)))]);
  assert.equal((await f.core.deliverOne()).accepted, true);await f.core.deliverOne();
  assert.equal(f.sent.length, 2);assert.equal(f.sent[0].token, f.sent[1].token);
  assert.match(f.sent[0].content.body, /Upper/);assert.match(f.sent[1].content.body, /Lower/);
});
test('unauthorized and tampered event requests are rejected', async () => {
  const f = fixture();const body = await envelope(event());body.event.position = 'lower';
  await assert.rejects(f.core.ingest(env, body));assert.equal(f.sent.length, 0);
  await assert.rejects(f.core.ingest({ ...env, NOTIFICATION_EVENT_KEYS: undefined }, await envelope(event())));
});
test('camera placement and batch association are server-validated', async () => {
  const f = fixture();await assert.rejects(f.core.ingest(env, await envelope({ ...event(), batchId: 'other' })));
  await assert.rejects(f.core.ingest(env, await envelope({ ...event(), position: 'lower' }, 'x'.repeat(24))));
});
test('duplicate event IDs cannot enqueue a second delivery and nonce replay is rejected', async () => {
  const f = fixture();await f.core.register('valid-session', phone);
  await f.core.ingest(env, await envelope(event()));
  assert.equal((await f.core.ingest(env, await envelope(event(), 'x'.repeat(24)))).duplicate, true);
  await assert.rejects(f.core.ingest(env, await envelope(event())));
  await f.core.deliverOne();assert.equal((await f.core.deliverOne()).processed, false);assert.equal(f.sent.length, 1);
});
test('a repeated camera hit cools down without suppressing the other camera', async () => {
  const f = fixture();await f.core.register('valid-session', phone);
  await f.core.ingest(env, await envelope(event()));
  await f.core.ingest(env, await envelope(event('upper', 'b'), 'b'.repeat(24)));
  await f.core.ingest(env, await envelope(event('lower'), 'l'.repeat(24)));
  await f.core.deliverOne();await f.core.deliverOne();assert.equal(f.sent.length, 2);
});
test('user authentication, membership and individual unregistration are enforced', async () => {
  const f = fixture();await assert.rejects(f.core.register('bad', phone));
  await assert.rejects(f.core.register('valid-session', { ...phone, incubatorId: 'another' }));
  await assert.rejects(f.core.register('valid-session', { ...phone, userId: 'other' }));
  await f.core.register('valid-session', phone);await f.core.unregister('valid-session', { incubatorId: 'inc01', browserId: 'phone1' });
  assert.equal(f.phones.size, 0);
});
test('invalid provider tokens are disabled and temporary failures are bounded', async () => {
  const f = fixture();await f.core.register('valid-session', phone);await f.core.ingest(env, await envelope(event()));
  f.setSend({ outcome: 'invalid-token' });await f.core.deliverOne();assert.equal(f.history.at(-1).disableToken, true);
  await f.core.ingest(env, await envelope(event('lower'), 'l'.repeat(24)));f.setSend({ outcome: 'retryable' });
  await f.core.deliverOne();assert.equal(f.history.at(-1).retryAt, time + 15);
});
test('unknown FCM outcomes are terminal and database failures cannot report success', async () => {
  const f = fixture();await f.core.register('valid-session', phone);await f.core.ingest(env, await envelope(event()));
  f.setSend({ outcome: 'unknown' });await f.core.deliverOne();assert.equal(f.history.at(-1).retryAt, null);
  f.repository.acceptEvent = async () => { throw new Error('synthetic database unavailable'); };
  await assert.rejects(f.core.ingest(env, await envelope(event('lower'), 'l'.repeat(24))));
});
test('disabled sources, expired signatures, wrong types and oversized event fields fail closed', async () => {
  const f = fixture();const sources = JSON.parse(env.NOTIFICATION_EVENT_SOURCES);sources['gateway-inc01'].enabled = false;
  await assert.rejects(f.core.ingest({ ...env, NOTIFICATION_EVENT_SOURCES: JSON.stringify(sources) }, await envelope(event())));
  const old = await envelope(event());old.issuedAt = time - 61;await assert.rejects(f.core.ingest(env, old));
  assert.throws(() => validateDetection({ ...event(), image: 'unexpected' }, time));
  assert.throws(() => validateDetection({ ...event(), type: 'temperature' }, time));
  assert.match(detectionNotification(event('lower'), 'Batch 2').body, /Lower Incubation Batch \(Batch 2\)/);
});
test('unconfigured integration is unavailable, never permissive', async () => {
  await assert.rejects(cloudNotificationCore({}).register('anything', phone), { status: 503 });
});
