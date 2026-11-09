// Runs the actual browser signing client against the unchanged Worker and isolated SQLite.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../../cloudflare-worker/src/index.js';
import { random, b64, hmacKey, signingMessage } from '../../cloudflare-worker/src/security.js';
const source = readFileSync(new URL('../../public/pairing-client.js', import.meta.url));
const { PairingClient, canonical } = await import('data:text/javascript;base64,' + source.toString('base64'));
class LocalD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON;CREATE TABLE push_tokens(id TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,device_name TEXT,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);');
    this.db.exec(readFileSync(new URL('../../cloudflare-worker/migrations/0001_pairing.sql', import.meta.url), 'utf8'));
    this.db.exec(readFileSync(new URL('../../cloudflare-worker/migrations/0002_retention_indexes.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) { const owner = this;return { sql, args: [],bind(...args) { this.args = args;return this; },async first() { return owner.db.prepare(sql).get(...this.args) || null; },async run() { return owner.execute(this); } }; }
  execute(s) { const q = this.db.prepare(s.sql);if (/^\s*SELECT/i.test(s.sql)) return { results: q.all(...s.args), meta: { changes: 0 } };return { results: [], meta: { changes: Number(q.run(...s.args).changes) } }; }
  async batch(statements) { this.db.exec('BEGIN IMMEDIATE');try { const result = statements.map(s => this.execute(s));this.db.exec('COMMIT');return result; } catch (error) { this.db.exec('ROLLBACK');throw error; } }
}
class MemoryStore { async get() { return this.value; }async put(value) { this.value = structuredClone(value); }async clear() { this.value = undefined; } }
const secret = random();const env = { DB: new LocalD1(), PAIRING_HASH_KEY: random(), NOTIFICATION_DEVICE_KEYS: JSON.stringify({ 'hatchai-inc01-controller': { key1: secret } }) };
for (const { name } of JSON.parse(readFileSync(new URL('../../cloudflare-worker/wrangler.jsonc', import.meta.url))).ratelimits) env[name] = { async limit() { return { success: true }; } };
let checks = 0;function check(value, name) { assert.ok(value, name);++checks; }
let loseRegister = false;
let noRedirects = true;
async function browserFetch(url, init) {
  noRedirects = noRedirects && init.redirect === 'error';
  check(!new URL(url).search, 'credentials never enter URLs');
  const response = await worker.fetch(new Request('http://localhost' + new URL(url).pathname, { ...init, headers: { ...init.headers, Origin: 'https://hatchai-8d34c.web.app' } }), env);
  if (loseRegister && new URL(url).pathname === '/register' && response.ok) { loseRegister = false;throw new TypeError('Injected lost response'); }
  return response;
}
async function device(path, fields) {
  const body = { deviceId: 'hatchai-inc01-controller', keyId: 'key1', ...fields };
  body.signature = b64(await crypto.subtle.sign('HMAC', await hmacKey(secret), await signingMessage(path, body)));
  const response = await worker.fetch(new Request('http://localhost' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
  assert.equal(response.status, 200);return response.json();
}
async function code() { const c = await device('/device/pairing/challenge', { requestId: random(), issuedAt: Math.floor(Date.now() / 1000), operation: 'start' });return (await device('/device/pairing/start', { sessionId: c.sessionId, challenge: c.challenge })).code; }
const oneStore = new MemoryStore(), twoStore = new MemoryStore();
const one = new PairingClient({ store: oneStore, fetcher: browserFetch }), two = new PairingClient({ store: twoStore, fetcher: browserFetch });
await one.redeem(await code());check(oneStore.value.privateKey.extractable === false, 'private key is non-extractable');
const first = await one.register('test-token-phone-one-abcdefghijklmnopqrstuvwxyz');check(first.registrationId, 'D1-confirmed first phone');
await two.redeem(await code());const second = await two.register('test-token-phone-two-abcdefghijklmnopqrstuvwxyz');check(first.registrationId !== second.registrationId, 'phones have independent registrations');
check(env.DB.db.prepare('SELECT COUNT(*) n FROM push_tokens WHERE enabled=1').get().n === 2, 'both phones preserved');
const reload = new PairingClient({ store: oneStore, fetcher: browserFetch });await reload.reconcile();await reload.register('test-token-phone-one-refresh-abcdefghijklmnopqrstuvwxyz');
check(env.DB.db.prepare('SELECT COUNT(*) n FROM push_tokens').get().n === 2, 'refresh does not create another registration');
// Actual browser signing client -> actual Worker/D1 -> intercepted Google provider.
const rsa = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
env.MANUAL_TEST_NOTIFICATIONS_ENABLED = 'true';
env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: 'service_account', project_id: 'hatchai-8d34c',
  client_email: 'phone-test@hatchai-8d34c.iam.gserviceaccount.com',
  private_key: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', rsa.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----\n` });
const originalFetch = globalThis.fetch, sends = [];
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'local-phone-oauth', expires_in: 3600 });
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/hatchai-8d34c/messages:send');
    sends.push(JSON.parse(options.body).message);return Response.json({ name: 'projects/hatchai-8d34c/messages/phone-test' });
  };
  check((await reload.sendTest()).accepted === true, 'browser-signed manual test accepted by real Worker');
  check(sends.length === 1 && sends[0].token === 'test-token-phone-one-refresh-abcdefghijklmnopqrstuvwxyz', 'first phone test has only its refreshed token');
  check(sends[0].notification.title === 'HATCHAI Test Notification' && sends[0].notification.body === 'Your HATCHAI notification system is working.', 'manual test exact fixed content');
  check((await two.sendTest()).displayConfirmed === false, 'second phone sends independently without claiming display');
  check(sends.length === 2 && sends[1].token === 'test-token-phone-two-abcdefghijklmnopqrstuvwxyz', 'second phone cannot broadcast to first');
} finally { globalThis.fetch = originalFetch; }
const lostStore = new MemoryStore(), lost = new PairingClient({ store: lostStore, fetcher: browserFetch });await lost.redeem(await code());loseRegister = true;
await assert.rejects(lost.register('test-token-lost-response-abcdefghijklmnopqrstuvwxyz'));await lost.reconcile();await lost.register('test-token-lost-response-abcdefghijklmnopqrstuvwxyz');
check(env.DB.db.prepare('SELECT COUNT(*) n FROM push_tokens').get().n === 3, 'lost response reconciled without duplicate');
const attacker = new PairingClient({ store: new MemoryStore(), fetcher: browserFetch });await attacker.redeem(await code());
await assert.rejects(attacker.register('test-token-phone-two-abcdefghijklmnopqrstuvwxyz'));check(env.DB.db.prepare('SELECT COUNT(*) n FROM push_tokens').get().n === 3, 'duplicate token cannot change ownership');
await two.unregister();check(env.DB.db.prepare('SELECT COUNT(*) n FROM push_tokens WHERE enabled=1').get().n === 2, 'unregister affects only requesting phone');
env.DB.db.prepare('UPDATE push_registration_auth SET created_at=unixepoch()-100,authorized_until=unixepoch()-1 WHERE registration_id=?').run(first.registrationId);
await assert.rejects(one.reconcile());++checks;
const before = oneStore.value;oneStore.value = { ...before, privateKey: undefined };await assert.rejects(one.register('test-token-phone-one-refresh-abcdefghijklmnopqrstuvwxyz'));oneStore.value = before;++checks;
check(canonical({ z: [2, 1], a: { b: true } }) === '{"a":{"b":true},"z":[2,1]}', 'recursive canonical compatibility');
check(noRedirects, 'signed request credentials cannot follow redirects');
const malformed = new PairingClient({ store: oneStore, fetcher: async () => new Response('PRIVATE_GRANT malformed response', { status: 200 }) });
await assert.rejects(malformed.post('/registration/challenge', { registrationId: first.registrationId }, await malformed.record()), error => error.message === 'Invalid notification server response.');++checks;
const disabled = await worker.fetch(new Request('http://localhost/chick-detected', { method: 'POST' }), env);check(disabled.status === 503, 'detection remains disabled');
console.log(`Phone/Worker integration: ${checks} checks passed; independent signed manual sends, 3 phones, refresh, lost response, ownership, unregistration and hard expiry.`);
env.DB.db.close();
