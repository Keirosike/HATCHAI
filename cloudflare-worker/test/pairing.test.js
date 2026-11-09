import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { b64, random, hmacKey, signingMessage, verifyDevice } from '../src/security.js';
import { cleanup } from '../src/retention.js';

// Real SQLite constraints/transactions, adapting only the D1 API surface.
// Each test receives a fresh in-memory DB, never Wrangler or production storage.
class LocalD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE push_tokens(id TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,device_name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    this.db.exec(readFileSync(new URL('../migrations/0001_pairing.sql', import.meta.url), 'utf8'));
    this.db.exec(readFileSync(new URL('../migrations/0002_retention_indexes.sql', import.meta.url), 'utf8'));
    this.failAuthInsert = false;
  }
  prepare(sql) {
    const owner = this;
    return {
      sql, args: [],
      bind(...args) { this.args = args; return this; },
      async first() { return owner.db.prepare(sql).get(...this.args) || null; },
      async run() { return owner.execute(this); }
    };
  }
  execute(s) {
    if (this.failAuthInsert && /INSERT INTO push_registration_auth/.test(s.sql)) throw new Error('Injected ownership failure');
    const query = this.db.prepare(s.sql);
    if (/^\s*SELECT/i.test(s.sql)) return { results: query.all(...s.args), meta: { changes: 0 } };
    const result = query.run(...s.args);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(s => this.execute(s));
      this.db.exec('COMMIT'); return results;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
}
class LocalLimiter {
  constructor(max) { this.max = max; this.counts = new Map(); }
  async limit({ key }) {
    const bucket = `${Math.floor(Date.now() / 60000)}:${key}`;
    const count = (this.counts.get(bucket) || 0) + 1; this.counts.set(bucket, count);
    return { success: count <= this.max };
  }
}
function setup() {
  const secret = random();
  const budgets = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')).ratelimits;
  const env = { DB: new LocalD1(), ...Object.fromEntries(budgets.map(b => [b.name, new LocalLimiter(b.simple.limit)])),
    PAIRING_HASH_KEY: random(), NOTIFICATION_DEVICE_KEYS: JSON.stringify({ 'hatchai-inc01-controller': { key1: secret } }) };
  const sql = (query, ...args) => env.DB.db.prepare(query).all(...args);
  const exec = (query, ...args) => env.DB.db.prepare(query).run(...args);
  const post = async (path, body, browser = false, extra = {}) => {
    const response = await worker.fetch(new Request('http://localhost' + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(browser ? { Origin: 'https://hatchai-8d34c.web.app' } : {}), ...extra },
      body: JSON.stringify(body) }), env);
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const deviceBody = async (path, fields = {}) => {
    const body = { deviceId: 'hatchai-inc01-controller', keyId: 'key1', ...fields };
    body.signature = b64(await crypto.subtle.sign('HMAC', await hmacKey(secret), await signingMessage(path, body)));
    return body;
  };
  const device = async (path, fields) => post(path, await deviceBody(path, fields));
  const challenge = async (operation) => {
    const result = await device('/device/pairing/challenge', { operation, requestId: random(), issuedAt: Math.floor(Date.now() / 1000) });
    assert.equal(result.status, 200); return result.body;
  };
  const start = async () => {
    const c = await challenge('start');
    const result = await device('/device/pairing/start', c); assert.equal(result.status, 200);
    return result.body;
  };
  return { env, sql, exec, post, device, deviceBody, challenge, start };
}
async function browser() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
  return { publicKey, async sign(path, fields) {
    const body = { ...fields };
    body.signature = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, await signingMessage(path, body)));
    return body;
  } };
}
async function redeem(s, pair, phone) {
  return s.post('/pairing/redeem', await phone.sign('/pairing/redeem', { code: pair.code, publicKey: phone.publicKey }), true);
}
async function enrolled(s, token = 'fcm_token_' + random()) {
  const phone = await browser(), pair = await s.start();
  const grant = await redeem(s, pair, phone); assert.equal(grant.status, 200);
  const body = await phone.sign('/register', { ...grant.body, token, deviceName: 'Android' });
  const registration = await s.post('/register', body, true); assert.equal(registration.status, 200);
  return { phone, pair, grant: grant.body, registration: registration.body, token, registerBody: body };
}
async function managementChallenge(s, e, lookup = { registrationId: e.registration.registrationId }) {
  const b = await e.phone.sign('/registration/challenge', { ...lookup, requestId: random(), issuedAt: Math.floor(Date.now() / 1000) });
  return s.post('/registration/challenge', b, true);
}

let testAccount;
async function mockFcm(t, s, outcome = 'ok') {
  // Ephemeral local test material only. No service account or Google service is used.
  if (!testAccount) testAccount = (async () => {
    const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
    return { keys, json: JSON.stringify({ type: 'service_account', project_id: 'hatchai-8d34c',
      client_email: 'local-test@hatchai-8d34c.iam.gserviceaccount.com',
      private_key: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64')}\n-----END PRIVATE KEY-----\n` }) };
  })();
  const account = await testAccount;
  s.env.MANUAL_TEST_NOTIFICATIONS_ENABLED = 'true';s.env.FCM_SERVICE_ACCOUNT_JSON = account.json;
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });assert.equal(options.redirect, 'manual');assert.ok(options.signal);
    if (url === 'https://oauth2.googleapis.com/token') {
      const jwt = options.body.get('assertion'), parts = jwt.split('.');
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
      assert.equal(claims.aud, url);assert.equal(claims.exp - claims.iat, 3600);
      assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', account.keys.publicKey,
        Buffer.from(parts[2], 'base64url'), new TextEncoder().encode(parts.slice(0, 2).join('.'))));
      if (outcome === 'oauth-failure') return Response.json({ private_error: 'provider-secret-response' }, { status: 401 });
      return Response.json({ access_token: 'local-ephemeral-oauth-token', expires_in: 3600 });
    }
    assert.equal(url, 'https://fcm.googleapis.com/v1/projects/hatchai-8d34c/messages:send');
    if (outcome === 'timeout') throw new Error('provider-secret-response');
    if (outcome === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://evil.invalid/' } });
    if (outcome === 'oversized') return new Response('provider-secret-response'.repeat(2000));
    if (outcome === 'failure') return Response.json({ error: 'provider-secret-response' }, { status: 500 });
    return Response.json({ name: 'projects/hatchai-8d34c/messages/local-test' });
  };
  t.after(() => { globalThis.fetch = original; });return calls;
}
async function testRequest(s, e) {
  const challenge = await managementChallenge(s, e);assert.equal(challenge.status, 200);
  return e.phone.sign('/registration/test-notification', {
    registrationId: e.registration.registrationId, nonce: challenge.body.nonce, version: challenge.body.version
  });
}

test('manual test uses existing browser ownership and targets only its token with exact fixed content', async t => {
  const s = setup(), one = await enrolled(s), two = await enrolled(s);
  const until = one.registration.authorizedUntil, calls = await mockFcm(t, s);
  const r = await s.post('/registration/test-notification', await testRequest(s, one), true);
  assert.equal(r.status, 200);assert.deepEqual(r.body, { accepted: true, displayConfirmed: false });
  const sends = calls.filter(c => c.url.includes('fcm.googleapis.com'));assert.equal(sends.length, 1);
  const message = JSON.parse(sends[0].options.body).message;
  assert.equal(message.token, one.token);assert.notEqual(message.token, two.token);
  assert.deepEqual(message.notification, { title: 'HATCHAI Test Notification', body: 'Your HATCHAI notification system is working.' });
  assert.equal(message.data.type, 'hatchai-manual-test');assert.equal(message.webpush.headers.TTL, '300');
  assert.equal(s.sql('SELECT authorized_until FROM push_registration_auth WHERE registration_id=?', one.registration.registrationId)[0].authorized_until, until);
  assert.equal(s.sql('SELECT COUNT(*) n FROM push_tokens WHERE enabled=1')[0].n, 2);
  assert.ok(!JSON.stringify(r.body).includes(one.token));
  assert.equal((await s.post('/chick-detected', {})).status, 503);
});
test('manual test rejects wrong browser key and injected destination or content', async t => {
  const s = setup(), one = await enrolled(s), two = await enrolled(s), calls = await mockFcm(t, s);
  const b = await testRequest(s, one);
  const forged = await two.phone.sign('/registration/test-notification', b);
  assert.equal((await s.post('/registration/test-notification', forged, true)).status, 401);
  const injected = await one.phone.sign('/registration/test-notification', { registrationId: b.registrationId, nonce: b.nonce, version: b.version, token: two.token });
  assert.equal((await s.post('/registration/test-notification', injected, true)).status, 400);
  assert.equal(calls.length, 0);
});
test('manual test enforces origin, signed requests and configuration kill switch', async t => {
  const s = setup(), e = await enrolled(s), calls = await mockFcm(t, s), b = await testRequest(s, e);
  assert.equal((await s.post('/registration/test-notification', b, false)).status, 403);
  assert.equal((await s.post('/registration/test-notification', { ...b, signature: random() }, true)).status, 401);
  s.env.MANUAL_TEST_NOTIFICATIONS_ENABLED = 'false';
  assert.equal((await s.post('/registration/test-notification', b, true)).status, 503);
  assert.equal(calls.length, 0);
  assert.equal(s.sql('SELECT version FROM push_registration_auth')[0].version, 0);
});
test('simultaneous manual sends with one nonce have exactly one external send', async t => {
  const s = setup(), e = await enrolled(s), calls = await mockFcm(t, s), b = await testRequest(s, e);
  const responses = await Promise.all([s.post('/registration/test-notification', b, true), s.post('/registration/test-notification', b, true)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await s.post('/registration/test-notification', b, true)).status, 409);
  assert.equal(calls.filter(c => c.url.includes('fcm.googleapis.com')).length, 1);
});
for (const reason of ['expired', 'revoked', 'disabled', 'expired-nonce', 'removed-controller-key']) {
  test(`manual test rejects ${reason} authorization before contacting Google`, async t => {
    const s = setup(), e = await enrolled(s), calls = await mockFcm(t, s), b = await testRequest(s, e);
    if (reason === 'expired') s.exec('UPDATE push_registration_auth SET authorized_until=unixepoch()-1,created_at=unixepoch()-100');
    if (reason === 'revoked') s.exec('UPDATE push_registration_auth SET revoked_at=unixepoch()');
    if (reason === 'disabled') s.exec('UPDATE push_tokens SET enabled=0');
    if (reason === 'expired-nonce') s.exec('UPDATE push_registration_auth SET nonce_expires_at=unixepoch()-1');
    if (reason === 'removed-controller-key') s.env.NOTIFICATION_DEVICE_KEYS = '{}';
    assert.ok((await s.post('/registration/test-notification', b, true)).status >= 400);assert.equal(calls.length, 0);
  });
}
for (const outcome of ['failure', 'timeout', 'redirect', 'oversized']) {
  test(`FCM ${outcome} consumes authorization and is never retried or exposed`, async t => {
    const s = setup(), e = await enrolled(s), calls = await mockFcm(t, s, outcome), b = await testRequest(s, e);
    const r = await s.post('/registration/test-notification', b, true);assert.equal(r.status, 502);
    assert.ok(!JSON.stringify(r.body).includes('provider-secret-response'));
    assert.equal((await s.post('/registration/test-notification', b, true)).status, 409);
    assert.equal(calls.filter(c => c.url.includes('fcm.googleapis.com')).length, 1);
    assert.equal(s.sql('SELECT enabled FROM push_tokens')[0].enabled, 1);
  });
}
test('manual test has a separate rate budget and does not consume unregister allowance', async t => {
  const s = setup(), e = await enrolled(s), calls = await mockFcm(t, s);
  for (let n = 0; n < 3; ++n) assert.equal((await s.post('/registration/test-notification', await testRequest(s, e), true)).status, 200);
  assert.equal((await s.post('/registration/test-notification', await testRequest(s, e), true)).status, 429);
  const c = await managementChallenge(s, e);
  assert.equal((await s.post('/unregister', await e.phone.sign('/unregister', { registrationId: e.registration.registrationId,
    nonce: c.body.nonce, version: c.body.version }), true)).status, 200);
  assert.equal(calls.filter(c => c.url.includes('fcm.googleapis.com')).length, 3);
});
test('OAuth rejection is sanitized and never attempts an FCM send', async t => {
  const s = setup(), e = await enrolled(s), calls = await mockFcm(t, s, 'oauth-failure');
  const r = await s.post('/registration/test-notification', await testRequest(s, e), true);
  assert.equal(r.status, 502);assert.ok(!JSON.stringify(r.body).includes('provider-secret-response'));
  assert.equal(calls.length, 1);assert.equal(calls.filter(c => c.url.includes('fcm.googleapis.com')).length, 0);
});
for (const operation of ['/registration/refresh', '/unregister']) {
  test(`manual send racing ${operation} has one fenced transition`, async t => {
    const s = setup(), e = await enrolled(s), calls = await mockFcm(t, s);
    const testBody = await testRequest(s, e);
    const manageBody = await e.phone.sign(operation, { registrationId: e.registration.registrationId,
      nonce: testBody.nonce, version: testBody.version, ...(operation.endsWith('refresh') ? { token: e.token } : {}) });
    const [send, manage] = await Promise.all([s.post('/registration/test-notification', testBody, true), s.post(operation, manageBody, true)]);
    assert.deepEqual([send.status, manage.status].sort(), [200, 409]);
    assert.equal(s.sql('SELECT version FROM push_registration_auth')[0].version, 1);
    assert.equal(calls.filter(c => c.url.includes('fcm.googleapis.com')).length, send.status === 200 ? 1 : 0);
  });
}

test('existing root/health, legacy records and disabled delivery are preserved', async () => {
  const s = setup(); s.exec(`INSERT INTO push_tokens(id,token) VALUES('legacy','legacy-token')`);
  for (const path of ['/', '/health']) {
    const r = await worker.fetch(new Request('http://localhost' + path), s.env); assert.equal(r.status, 200);
    const data = await r.json(); if (path === '/health') assert.equal(data.registeredDevices, 1);
  }
  assert.equal((await s.post('/chick-detected', {})).status, 503);
  assert.equal(s.sql('SELECT * FROM push_tokens')[0].token, 'legacy-token');
});
test('device challenge requires real authentication and cannot be replayed', async () => {
  const s = setup();
  assert.equal((await s.post('/device/pairing/challenge', {})).status, 400);
  const body = await s.deviceBody('/device/pairing/challenge', { operation: 'start', requestId: random(), issuedAt: Math.floor(Date.now() / 1000) });
  assert.equal((await s.post('/device/pairing/challenge', body)).status, 200);
  assert.equal((await s.post('/device/pairing/challenge', body)).status, 409);
  assert.equal((await s.post('/device/pairing/challenge', { ...body, operation: 'cancel' })).status, 401);
  assert.equal((await s.post('/device/pairing/challenge', body, true)).status, 403);
});
test('codes are uniform alphabet, 16 characters, protected in storage and expire in 300 seconds', async () => {
  const s = setup(), p = await s.start(); assert.match(p.code, /^[A-Z2-7]{16}$/);
  const row = s.sql('SELECT * FROM pairing_sessions WHERE id=?', p.pairingId)[0];
  assert.equal(row.code_expires_at - row.code_issued_at, 300);
  assert.ok(!JSON.stringify(row).includes(p.code));
  const c = await s.challenge('status');
  const status = await s.device('/device/pairing/status', { ...c, pairingId: p.pairingId });
  assert.equal(status.body.state, 'issued'); assert.ok(!JSON.stringify(status.body).includes(p.code));
  assert.notEqual((await s.device('/device/pairing/status', { ...c, pairingId: p.pairingId })).status, 200);
});
test('expired codes, expired device challenges and stale signed requests fail', async () => {
  const s = setup(), p = await s.start(), phone = await browser();
  s.exec('UPDATE pairing_sessions SET code_issued_at=unixepoch()-301,code_expires_at=unixepoch()-1 WHERE id=?', p.pairingId);
  assert.equal((await redeem(s, p, phone)).status, 401);
  const c = await s.challenge('start');
  s.exec('UPDATE pairing_sessions SET created_at=unixepoch()-100,challenge_expires_at=unixepoch()-1 WHERE id=?', c.sessionId);
  assert.equal((await s.device('/device/pairing/start', c)).status, 401);
  assert.equal((await s.device('/device/pairing/challenge', { operation: 'start', requestId: random(), issuedAt: 1 })).status, 401);
});
test('simultaneous redemption binds exactly one browser key', async () => {
  const s = setup(), p = await s.start(), a = await browser(), b = await browser();
  const results = await Promise.all([redeem(s, p, a), redeem(s, p, b)]);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(s.sql("SELECT * FROM pairing_sessions WHERE state='redeemed'").length, 1);
});
test('simultaneous registration has exactly one complete owner, no orphan token', async () => {
  const s = setup(), p = await s.start(), phone = await browser(), g = await redeem(s, p, phone);
  const body = await phone.sign('/register', { ...g.body, token: 'fcm_' + random() });
  const results = await Promise.all([s.post('/register', body, true), s.post('/register', body, true)]);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(s.sql('SELECT * FROM push_tokens').length, 1);
  assert.equal(s.sql('SELECT * FROM push_registration_auth').length, 1);
  assert.equal(s.sql('PRAGMA foreign_key_check').length, 0);
});
test('a stolen grant without its bound signing key cannot register', async () => {
  const s = setup(), p = await s.start(), owner = await browser(), attacker = await browser();
  const g = await redeem(s, p, owner);
  const forged = await attacker.sign('/register', { ...g.body, token: 'fcm_' + random() });
  assert.equal((await s.post('/register', forged, true)).status, 401);
  assert.equal(s.sql('SELECT * FROM push_tokens').length, 0);
});
test('duplicate token transaction rolls back its grant consumption and preserves existing owner', async () => {
  const s = setup(), e = await enrolled(s), p = await s.start(), phone = await browser();
  const g = await redeem(s, p, phone);
  const duplicate = await phone.sign('/register', { ...g.body, token: e.token });
  assert.equal((await s.post('/register', duplicate, true)).status, 409);
  assert.equal(s.sql('SELECT state FROM pairing_sessions WHERE id=?', p.pairingId)[0].state, 'redeemed');
  assert.equal(s.sql('SELECT * FROM push_tokens').length, 1);
  const retry = await phone.sign('/register', { ...g.body, token: 'different_' + random() });
  assert.equal((await s.post('/register', retry, true)).status, 200);
  assert.equal(s.sql('SELECT * FROM push_tokens').length, 2);
});
test('ownership insert failure rolls back token insert and authorization claim', async () => {
  const s = setup(), p = await s.start(), phone = await browser(), g = await redeem(s, p, phone);
  s.env.DB.failAuthInsert = true;
  const result = await s.post('/register', await phone.sign('/register', { ...g.body, token: 'fcm_' + random() }), true);
  assert.equal(result.status, 503);
  assert.equal(s.sql('SELECT * FROM push_tokens').length, 0);
  assert.equal(s.sql('SELECT state FROM pairing_sessions WHERE id=?', p.pairingId)[0].state, 'redeemed');
});
test('lost registration response reconciles with pairing ID and private key; replay writes nothing', async () => {
  const s = setup(), e = await enrolled(s);
  assert.equal((await s.post('/register', e.registerBody, true)).status, 409);
  const found = await managementChallenge(s, e, { pairingId: e.pair.pairingId });
  assert.equal(found.body.registrationId, e.registration.registrationId);
  assert.equal(s.sql('SELECT * FROM push_tokens').length, 1);
});
test('refresh is owner-only, consumes nonce, and never extends 90-day authorization', async () => {
  const s = setup(), e = await enrolled(s), c = await managementChallenge(s, e), attacker = await browser();
  const fields = { registrationId: e.registration.registrationId, nonce: c.body.nonce, version: c.body.version, token: 'updated_' + random() };
  assert.equal((await s.post('/registration/refresh', await attacker.sign('/registration/refresh', fields), true)).status, 401);
  const signed = await e.phone.sign('/registration/refresh', fields);
  const results = await Promise.all([s.post('/registration/refresh', signed, true), s.post('/registration/refresh', signed, true)]);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  const auth = s.sql('SELECT * FROM push_registration_auth')[0];
  assert.equal(auth.authorized_until, e.registration.authorizedUntil);
  assert.equal(auth.authorized_until - auth.created_at, 90 * 86400);
});
test('expired grant cannot register', async () => {
  const s = setup(), p = await s.start(), phone = await browser(), g = await redeem(s, p, phone);
  s.exec('UPDATE pairing_sessions SET grant_expires_at=unixepoch()-1 WHERE id=?', p.pairingId);
  assert.equal((await s.post('/register', await phone.sign('/register', { ...g.body, token: 'fcm_' + random() }), true)).status, 409);
  assert.equal(s.sql('SELECT * FROM push_tokens').length, 0);
});
test('cancel invalidates code and wrong-purpose device challenge is refused', async () => {
  const s = setup(), p = await s.start(), c = await s.challenge('cancel');
  assert.equal((await s.device('/device/pairing/start', c)).status, 401);
  assert.equal((await s.device('/device/pairing/cancel', { ...c, pairingId: p.pairingId })).status, 200);
  assert.equal((await redeem(s, p, await browser())).status, 401);
});
test('unregister affects only one phone; revoked authorization cannot be revived', async () => {
  const s = setup(), a = await enrolled(s), b = await enrolled(s), c = await managementChallenge(s, a);
  const fields = { registrationId: a.registration.registrationId, nonce: c.body.nonce, version: c.body.version };
  assert.equal((await s.post('/unregister', await a.phone.sign('/unregister', fields), true)).status, 200);
  assert.equal(s.sql('SELECT enabled FROM push_tokens WHERE id=?', b.registration.registrationId)[0].enabled, 1);
  assert.equal((await managementChallenge(s, a)).status, 401);
  assert.equal(s.sql('SELECT * FROM push_tokens').length, 2);
});
test('90-day expiry and device key revocation fail closed', async () => {
  const s = setup(), a = await enrolled(s);
  s.exec('UPDATE push_registration_auth SET created_at=unixepoch()-9000000,authorized_until=unixepoch()-1');
  assert.equal((await managementChallenge(s, a)).status, 401);
  const t = setup(), b = await enrolled(t); t.env.NOTIFICATION_DEVICE_KEYS = '{}';
  assert.equal((await managementChallenge(t, b)).status, 401);
});
test('rate limits, absent limiters, body limits, CORS and credential URLs fail closed', async () => {
  const s = setup(); s.env.BROWSER_REGISTER_LIMITER = new LocalLimiter(1);
  assert.equal((await s.post('/register', {}, true)).status, 400);
  assert.equal((await s.post('/register', {}, true)).status, 429);
  delete s.env.BROWSER_REGISTER_LIMITER;
  assert.equal((await s.post('/register', {}, true)).status, 503);
  const t = setup();
  assert.equal((await t.post('/register', {}, false)).status, 403);
  assert.equal((await t.post('/register?grant=secret', {}, true)).status, 400);
  assert.equal((await t.post('/register', { pad: 'x'.repeat(9000) }, true)).status, 413);
  const r = await worker.fetch(new Request('http://localhost/register', { method: 'OPTIONS', headers: { Origin: 'https://hatchai-8d34c.web.app' } }), t.env);
  assert.equal(r.status, 200); assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://hatchai-8d34c.web.app');
});

test('refresh collision rolls back nonce/version and preserves both phones', async () => {
  const s = setup(), a = await enrolled(s), b = await enrolled(s), c = await managementChallenge(s, a);
  const body = await a.phone.sign('/registration/refresh', { registrationId: a.registration.registrationId,
    nonce: c.body.nonce, version: c.body.version, token: b.token });
  assert.equal((await s.post('/registration/refresh', body, true)).status, 409);
  const row = s.sql('SELECT * FROM push_registration_auth WHERE registration_id=?', a.registration.registrationId)[0];
  assert.equal(row.version, c.body.version); assert.equal(row.request_nonce, c.body.nonce);
  assert.equal(s.sql('SELECT token FROM push_tokens WHERE id=?', a.registration.registrationId)[0].token, a.token);
});
test('cross-phone unregister and discovery cannot use another phone signing key', async () => {
  const s = setup(), a = await enrolled(s), b = await enrolled(s), c = await managementChallenge(s, b);
  const forged = await a.phone.sign('/unregister', { registrationId: b.registration.registrationId,
    nonce: c.body.nonce, version: c.body.version });
  assert.equal((await s.post('/unregister', forged, true)).status, 401);
  const discovery = await a.phone.sign('/registration/challenge', { pairingId: b.pair.pairingId,
    requestId: random(), issuedAt: Math.floor(Date.now() / 1000) });
  assert.equal((await s.post('/registration/challenge', discovery, true)).status, 401);
  assert.equal(s.sql('SELECT COUNT(*) AS n FROM push_tokens WHERE enabled=1')[0].n, 2);
});
test('legacy token cannot be adopted and errors contain neither token nor secret code', async () => {
  const s = setup(), token = 'legacy_' + random();
  s.exec('INSERT INTO push_tokens(id,token) VALUES(?,?)', 'existing-record', token);
  const p = await s.start(), phone = await browser(), g = await redeem(s, p, phone);
  const r = await s.post('/register', await phone.sign('/register', { ...g.body, token }), true);
  assert.equal(r.status, 409);
  for (const secret of [token, p.code, g.body.grant]) assert.ok(!JSON.stringify(r.body).includes(secret));
  assert.equal(s.sql('SELECT * FROM push_registration_auth').length, 0);
  assert.equal(s.sql('SELECT id FROM push_tokens')[0].id, 'existing-record');
});
test('expired management nonce, malformed key and tampered token cannot authorize writes', async () => {
  const s = setup(), e = await enrolled(s), c = await managementChallenge(s, e);
  const fields = { registrationId: e.registration.registrationId, nonce: c.body.nonce, version: c.body.version, token: 'fcm_' + random() };
  const signed = await e.phone.sign('/registration/refresh', fields);
  assert.equal((await s.post('/registration/refresh', { ...signed, token: 'tampered_' + random() }, true)).status, 401);
  s.exec('UPDATE push_registration_auth SET nonce_expires_at=unixepoch()-1');
  assert.equal((await s.post('/registration/refresh', signed, true)).status, 409);
  const p = await s.start();
  assert.equal((await s.post('/pairing/redeem', { code: p.code, publicKey: { kty: 'RSA' } }, true)).status, 400);
});
test('lost redemption response cannot replay a code and a fresh start can follow cancellation', async () => {
  const s = setup(), phone = await browser(), p = await s.start();
  assert.equal((await redeem(s, p, phone)).status, 200);
  assert.equal((await redeem(s, p, phone)).status, 401);
  const c = await s.challenge('cancel');
  assert.equal((await s.device('/device/pairing/cancel', { ...c, pairingId: p.pairingId })).status, 200);
  assert.notEqual((await s.start()).pairingId, p.pairingId);
});

test('cancellation racing redemption cannot leave a usable grant after cancellation', async () => {
  for (const reverse of [false, true]) {
    const s = setup(), p = await s.start(), phone = await browser(), c = await s.challenge('cancel');
    const jobs = [() => s.device('/device/pairing/cancel', { ...c, pairingId: p.pairingId }), () => redeem(s, p, phone)];
    if (reverse) jobs.reverse();
    const results = await Promise.all(jobs.map(job => job()));
    assert.equal(s.sql('SELECT state FROM pairing_sessions WHERE id=?', p.pairingId)[0].state, 'cancelled');
    const grant = results.find(r => r.status === 200 && r.body.grant);
    if (grant) assert.equal((await s.post('/register', await phone.sign('/register', {
      ...grant.body, token: 'race_' + random()
    }), true)).status, 409);
    assert.equal(s.sql('SELECT * FROM push_tokens').length, 0);
    assert.equal(s.sql('SELECT * FROM push_registration_auth').length, 0);
  }
});
test('cancellation racing registration has either cancellation or one complete registration', async () => {
  for (const reverse of [false, true]) {
    const s = setup(), p = await s.start(), phone = await browser(), g = await redeem(s, p, phone);
    const c = await s.challenge('cancel');
    const registration = await phone.sign('/register', { ...g.body, token: 'race_' + random() });
    const jobs = [() => s.device('/device/pairing/cancel', { ...c, pairingId: p.pairingId }),
      () => s.post('/register', registration, true)];
    if (reverse) jobs.reverse();
    await Promise.all(jobs.map(job => job()));
    const state = s.sql('SELECT state FROM pairing_sessions WHERE id=?', p.pairingId)[0].state;
    assert.ok(['registered', 'cancelled'].includes(state));
    const n = state === 'registered' ? 1 : 0;
    assert.equal(s.sql('SELECT * FROM push_tokens').length, n);
    assert.equal(s.sql('SELECT * FROM push_registration_auth').length, n);
    assert.equal(s.sql('PRAGMA foreign_key_check').length, 0);
  }
});
test('different concurrent start challenges issue only one active code', async () => {
  const s = setup(), a = await s.challenge('start'), b = await s.challenge('start');
  const r = await Promise.all([s.device('/device/pairing/start', a), s.device('/device/pairing/start', b)]);
  assert.equal(r.filter(x => x.status === 200).length, 1);
  assert.equal(r.filter(x => x.status === 409).length, 1);
  assert.equal(s.sql("SELECT * FROM pairing_sessions WHERE state='issued'").length, 1);
});
for (const operation of ['/registration/refresh', '/unregister']) {
  for (const expired of [false, true]) {
    test(`challenge renewal versus ${operation}, nonce ${expired ? 'expired' : 'live'}`, async () => {
      const s = setup(), e = await enrolled(s), c = await managementChallenge(s, e);
      if (expired) s.exec('UPDATE push_registration_auth SET nonce_expires_at=unixepoch()-1');
      const signed = await e.phone.sign(operation, { registrationId: e.registration.registrationId,
        nonce: c.body.nonce, version: c.body.version, ...(operation.endsWith('refresh') ? { token: e.token } : {}) });
      const [renewal, mutation] = await Promise.all([managementChallenge(s, e), s.post(operation, signed, true)]);
      assert.ok([200, 401].includes(renewal.status));
      assert.equal(mutation.status, expired ? 409 : 200);
      const auth = s.sql('SELECT * FROM push_registration_auth')[0];
      assert.equal(auth.version, expired ? 0 : 1);
      assert.equal(auth.revoked_at !== null, !expired && operation === '/unregister');
      const enabled = s.sql('SELECT enabled FROM push_tokens')[0].enabled;
      assert.equal(enabled, !expired && operation === '/unregister' ? 0 : 1);
      assert.notEqual((await s.post(operation, signed, true)).status, 200);
    });
  }
}

async function signAs(deviceId, secret, path, fields = {}) {
  const body = { deviceId, keyId: 'key1', ...fields };
  body.signature = b64(await crypto.subtle.sign('HMAC', await hmacKey(secret), await signingMessage(path, body)));
  return body;
}
async function pairingTargets(s) {
  const p = await s.start();
  const start = await s.challenge('start'), status = await s.challenge('status'), cancel = await s.challenge('cancel');
  return [
    ['/device/pairing/challenge', { operation: 'start', requestId: random(), issuedAt: Math.floor(Date.now() / 1000) }],
    ['/device/pairing/start', start],
    ['/device/pairing/status', { ...status, pairingId: p.pairingId }],
    ['/device/pairing/cancel', { ...cancel, pairingId: p.pairingId }]
  ];
}
test('approved controller identity retains challenge/start/status/cancel compatibility', async () => {
  const s = setup(), p = await s.start();
  const row = s.sql('SELECT device_id FROM pairing_sessions WHERE id=?', p.pairingId)[0];
  assert.equal(row.device_id, 'hatchai-inc01-controller');
  const status = await s.challenge('status');
  assert.equal((await s.device('/device/pairing/status', { ...status, pairingId: p.pairingId })).body.state, 'issued');
  const cancel = await s.challenge('cancel');
  assert.equal((await s.device('/device/pairing/cancel', { ...cancel, pairingId: p.pairingId })).body.state, 'cancelled');
});
for (const cameraId of ['hatchai-inc01-cam01', 'hatchai-inc01-cam02']) {
  test(`${cameraId}: valid HMAC cannot access any pairing operation even if mistakenly added to pairing secrets`, async () => {
    const s = setup(), targets = await pairingTargets(s), cameraSecret = random();
    // Ephemeral negative-test credentials only; no real secrets are provisioned.
    const keys = JSON.parse(s.env.NOTIFICATION_DEVICE_KEYS); keys[cameraId] = { key1: cameraSecret };
    s.env.NOTIFICATION_DEVICE_KEYS = JSON.stringify(keys);
    const before = s.sql('SELECT * FROM pairing_sessions ORDER BY id');
    for (const [path, fields] of targets) {
      const body = await signAs(cameraId, cameraSecret, path, { ...fields, role: 'controller' });
      await verifyDevice(s.env, path, body); // Signature really is valid; role enforcement must reject it.
      const result = await s.post(path, body);
      assert.equal(result.status, 403); assert.equal(result.body.message, 'Controller pairing only');
      assert.ok(!result.body.code && !result.body.grant);
    }
    assert.deepEqual(s.sql('SELECT * FROM pairing_sessions ORDER BY id'), before);
  });
  test(`${cameraId}: future camera-secret binding cannot authorize controller operations or impersonation`, async () => {
    const s = setup(), targets = await pairingTargets(s), cameraSecret = random();
    s.env.CAMERA_EVENT_DEVICE_KEYS = JSON.stringify({ [cameraId]: { key1: cameraSecret } });
    for (const [path, fields] of targets) {
      assert.equal((await s.post(path, await signAs(cameraId, cameraSecret, path, fields))).status, 401);
      const impersonation = await signAs('hatchai-inc01-controller', cameraSecret, path, fields);
      assert.equal((await s.post(path, impersonation)).status, 401);
    }
  });
}
test('invalid controller signatures and unknown identities are rejected on all four endpoints', async () => {
  const s = setup(), targets = await pairingTargets(s);
  for (const [path, fields] of targets) {
    const invalid = await s.deviceBody(path, fields); invalid.signature = random();
    assert.equal((await s.post(path, invalid)).status, 401);
    assert.equal((await s.post(path, await signAs('unknown-board', random(), path, fields))).status, 401);
  }
});
for (const mode of ['device removed', 'key removed', 'key disabled']) {
  test(`${mode}: controller cannot initiate, inspect or cancel pairing`, async () => {
    const s = setup(), targets = await pairingTargets(s);
    const signed = await Promise.all(targets.map(async ([path, fields]) => [path, await s.deviceBody(path, fields)]));
    const keys = JSON.parse(s.env.NOTIFICATION_DEVICE_KEYS);
    if (mode === 'device removed') delete keys['hatchai-inc01-controller'];
    else if (mode === 'key removed') keys['hatchai-inc01-controller'] = {};
    else keys['hatchai-inc01-controller'].key1 = null;
    s.env.NOTIFICATION_DEVICE_KEYS = JSON.stringify(keys);
    const before = s.sql('SELECT * FROM pairing_sessions ORDER BY id');
    for (const [path, body] of signed) assert.equal((await s.post(path, body)).status, 401);
    assert.deepEqual(s.sql('SELECT * FROM pairing_sessions ORDER BY id'), before);
  });
}
test('a credentialed but unregistered role cannot become a controller by declaring its role', async () => {
  const s = setup(), secret = random(), path = '/device/pairing/challenge';
  const keys = JSON.parse(s.env.NOTIFICATION_DEVICE_KEYS); keys['unreviewed-board'] = { key1: secret };
  s.env.NOTIFICATION_DEVICE_KEYS = JSON.stringify(keys);
  const body = await signAs('unreviewed-board', secret, path, { role: 'controller', operation: 'start',
    requestId: random(), issuedAt: Math.floor(Date.now() / 1000) });
  await verifyDevice(s.env, path, body);
  assert.equal((await s.post(path, body)).status, 403);
  assert.equal(s.sql('SELECT * FROM pairing_sessions').length, 0);
});
test('browser management rejects a legacy camera-originated authorization even with a valid browser signature', async () => {
  const s = setup(), e = await enrolled(s), cameraId = 'hatchai-inc01-cam01';
  const keys = JSON.parse(s.env.NOTIFICATION_DEVICE_KEYS); keys[cameraId] = { key1: random() };
  s.env.NOTIFICATION_DEVICE_KEYS = JSON.stringify(keys);
  // Model pre-enforcement data, without granting any new camera authorization.
  s.exec('UPDATE push_registration_auth SET device_id=?', cameraId);
  assert.equal((await managementChallenge(s, e)).status, 403);
  assert.equal(s.sql('SELECT enabled FROM push_tokens')[0].enabled, 1); // No records rewritten or deleted.
});
test('code is rejected at the exact database expiry second', async () => {
  const s = setup(), p = await s.start(), phone = await browser();
  const boundary = Math.floor(Date.now() / 1000);
  // Deterministic DB clock, not a sleep vulnerable to second-boundary flakiness.
  s.env.DB.db.function('unixepoch', () => boundary);
  s.exec('UPDATE pairing_sessions SET code_issued_at=?,code_expires_at=? WHERE id=?', boundary - 300, boundary, p.pairingId);
  assert.equal((await redeem(s, p, phone)).status, 401);
  assert.equal(s.sql('SELECT state FROM pairing_sessions WHERE id=?', p.pairingId)[0].state, 'issued');
});
test('repeated requests after cancellation cannot reactivate a code', async () => {
  const s = setup(), p = await s.start(), c = await s.challenge('cancel'), phone = await browser();
  const cancel = await s.deviceBody('/device/pairing/cancel', { ...c, pairingId: p.pairingId });
  assert.equal((await s.post('/device/pairing/cancel', cancel)).status, 200);
  for (let i = 0; i < 3; i++) {
    assert.notEqual((await s.post('/device/pairing/cancel', cancel)).status, 200);
    assert.equal((await redeem(s, p, phone)).status, 401);
  }
  assert.equal(s.sql('SELECT state FROM pairing_sessions WHERE id=?', p.pairingId)[0].state, 'cancelled');
});
test('duplicate redemption requests return no additional grants', async () => {
  const s = setup(), p = await s.start(), phone = await browser();
  const body = await phone.sign('/pairing/redeem', { code: p.code, publicKey: phone.publicKey });
  assert.equal((await s.post('/pairing/redeem', body, true)).status, 200);
  const duplicates = await Promise.all([s.post('/pairing/redeem', body, true), s.post('/pairing/redeem', body, true)]);
  assert.ok(duplicates.every(r => r.status === 401 && !r.body.grant));
});
test('status budget exhaustion cannot starve cancellation or new start challenges', async () => {
  const s = setup(), p = await s.start(); s.env.DEVICE_STATUS_LIMITER = new LocalLimiter(2);
  const c = await s.challenge('status');
  assert.equal((await s.device('/device/pairing/status', { ...c, pairingId: p.pairingId })).status, 200);
  const exhausted = await s.device('/device/pairing/challenge', { operation: 'status', requestId: random(), issuedAt: Math.floor(Date.now() / 1000) });
  assert.equal(exhausted.status, 429);
  const cancel = await s.challenge('cancel');
  assert.equal((await s.device('/device/pairing/cancel', { ...cancel, pairingId: p.pairingId })).status, 200);
  assert.ok((await s.challenge('start')).sessionId);
});
test('registration challenge exhaustion cannot starve unregister', async () => {
  const s = setup(), e = await enrolled(s); s.env.REGISTRATION_LIMITER = new LocalLimiter(2);
  const c = await managementChallenge(s, e);
  assert.equal((await managementChallenge(s, e)).status, 200);
  assert.equal((await managementChallenge(s, e)).status, 429);
  const signed = await e.phone.sign('/unregister', { registrationId: e.registration.registrationId,
    nonce: c.body.nonce, version: c.body.version });
  assert.equal((await s.post('/unregister', signed, true)).status, 200);
});
test('retention preserves unexpired grants even after the original code expiry', async () => {
  const s = setup(), p = await s.start(), phone = await browser(), g = await redeem(s, p, phone);
  s.exec('UPDATE pairing_sessions SET code_issued_at=unixepoch()-301,code_expires_at=unixepoch()-1 WHERE id=?', p.pairingId);
  await cleanup(s.env);
  assert.equal(s.sql('SELECT state FROM pairing_sessions WHERE id=?', p.pairingId)[0].state, 'redeemed');
  const r = await s.post('/register', await phone.sign('/register', { ...g.body, token: 'retained_' + random() }), true);
  assert.equal(r.status, 200);
});
test('retention preserves registered pairing lookup and lost-response reconciliation', async () => {
  const s = setup(), e = await enrolled(s);
  s.exec('UPDATE pairing_sessions SET registered_at=unixepoch()-691200 WHERE id=?', e.pair.pairingId);
  await cleanup(s.env);
  assert.equal((await managementChallenge(s, e, { pairingId: e.pair.pairingId })).body.registrationId, e.registration.registrationId);
  assert.equal(s.sql('SELECT * FROM push_tokens').length, 1);
});
test('retention deletes only old terminal sessions and cannot recreate replayed challenges', async () => {
  const s = setup(), c = await s.challenge('start');
  const signedStart = await s.deviceBody('/device/pairing/start', c);
  const p = await s.post('/device/pairing/start', signedStart);
  const cancel = await s.challenge('cancel');
  await s.device('/device/pairing/cancel', { ...cancel, pairingId: p.body.pairingId });
  s.exec("UPDATE pairing_sessions SET updated_at=unixepoch()-86401 WHERE state='cancelled'");
  const result = await cleanup(s.env); assert.equal(result.deleted, 2);
  assert.equal(s.sql('SELECT * FROM pairing_sessions').length, 0);
  assert.equal((await s.post('/device/pairing/start', signedStart)).status, 401);
  const stale = await s.device('/device/pairing/challenge', { operation: 'start', requestId: c.sessionId,
    issuedAt: Math.floor(Date.now() / 1000) - 86401 });
  assert.equal(stale.status, 401);
});
test('retention retires expired nonces without accumulating challenge rows or reviving authorization', async () => {
  const s = setup(), e = await enrolled(s), c = await managementChallenge(s, e);
  s.exec('UPDATE push_registration_auth SET nonce_expires_at=unixepoch()-1');
  const result = await cleanup(s.env); assert.equal(result.retiredNonces, 1);
  assert.equal((await cleanup(s.env)).retiredNonces, 0);
  const old = await e.phone.sign('/registration/refresh', { registrationId: e.registration.registrationId,
    nonce: c.body.nonce, version: c.body.version, token: e.token });
  assert.equal((await s.post('/registration/refresh', old, true)).status, 409);
  const fresh = await managementChallenge(s, e);
  assert.equal(fresh.status, 200); assert.equal(fresh.body.version, c.body.version + 1);
  assert.equal(s.sql('SELECT * FROM push_registration_auth').length, 1);
});
test('97-day registered session cleanup preserves token/auth rows and active authorization links', async () => {
  const s = setup(), e = await enrolled(s);
  s.exec('UPDATE pairing_sessions SET registered_at=unixepoch()-8380801');
  assert.equal((await cleanup(s.env)).deleted, 0); // Defense if authorization ever outlives nominal 90 days.
  s.exec('UPDATE push_registration_auth SET created_at=unixepoch()-9000000,authorized_until=unixepoch()-1');
  assert.equal((await cleanup(s.env)).deleted, 1);
  assert.equal(s.sql('SELECT pairing_session_id FROM push_registration_auth')[0].pairing_session_id, null);
  assert.equal(s.sql('SELECT token FROM push_tokens')[0].token, e.token);
  assert.equal(s.sql('PRAGMA foreign_key_check').length, 0);
  assert.equal((await managementChallenge(s, e)).status, 401);
});
test('cleanup has a strict per-invocation work bound and drains backlog on later runs', async () => {
  const s = setup();
  const insert = s.env.DB.db.prepare(`INSERT INTO pairing_sessions
    (id,device_id,device_key_id,state,device_challenge,challenge_expires_at,created_at,updated_at)
    VALUES(?,'incubator1','key1','cancelled',?,unixepoch()-99999,unixepoch()-200000,unixepoch()-100000)`);
  for (let i = 0; i < 1100; i++) insert.run(random(), random());
  const full = await cleanup(s.env);
  assert.equal(full.deleted, 1000); assert.equal(full.backlogPossible, true);
  assert.equal(s.sql('SELECT COUNT(*) AS n FROM pairing_sessions')[0].n, 100);
  const drained = await cleanup(s.env);
  assert.equal(drained.deleted, 100); assert.equal(drained.backlogPossible, false);
});
test('cleanup expires all three transient states but leaves a live redeemed grant intact', async () => {
  const s = setup();
  const boundary = Math.floor(Date.now() / 1000);
  s.env.DB.db.function('unixepoch', () => boundary);
  function seed(state, grantExpiry) {
    const sessionId = random();
    s.exec(`INSERT INTO pairing_sessions(id,device_id,device_key_id,state,device_challenge,challenge_expires_at,
      code_hash,code_issued_at,code_expires_at,browser_public_key_jwk,grant_hash,grant_expires_at,
      redeemed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    sessionId, random(), 'key1', state, random(), boundary - 340, random(), boundary - 301,
    boundary - 1, '{}', random(), grantExpiry, boundary - 100, boundary - 400, boundary - 100);
    return sessionId;
  }
  const expired = [seed('challenge', boundary - 1), seed('issued', boundary - 1), seed('redeemed', boundary - 1)];
  const live = seed('redeemed', boundary + 100);
  assert.equal((await cleanup(s.env)).expired, 3);
  for (const sessionId of expired) {
    const row = s.sql('SELECT * FROM pairing_sessions WHERE id=?', sessionId)[0];
    assert.equal(row.state, 'expired'); assert.equal(row.code_hash, null); assert.equal(row.grant_hash, null);
  }
  assert.equal(s.sql('SELECT state FROM pairing_sessions WHERE id=?', live)[0].state, 'redeemed');
  assert.equal(s.sql('SELECT COUNT(*) AS n FROM pairing_sessions')[0].n, 4);
});
for (const operation of ['/registration/refresh', '/unregister']) {
  test(`nonce cleanup racing ${operation} fails safely for an expired nonce`, async () => {
    const s = setup(), e = await enrolled(s), c = await managementChallenge(s, e);
    s.exec('UPDATE push_registration_auth SET nonce_expires_at=unixepoch()-1');
    const signed = await e.phone.sign(operation, { registrationId: e.registration.registrationId,
      nonce: c.body.nonce, version: c.body.version, ...(operation.endsWith('refresh') ? { token: e.token } : {}) });
    const [, result] = await Promise.all([cleanup(s.env), s.post(operation, signed, true)]);
    assert.equal(result.status, 409);
    assert.equal(s.sql('SELECT enabled FROM push_tokens')[0].enabled, 1);
  });
}
