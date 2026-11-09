import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { random, b64, hmacKey, signingMessage } from '../src/security.js';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require(process.env.HATCHAI_MINIFLARE || 'miniflare');
const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
let cases = 0, requests = 0;

async function scenario(name, run, negativeRoleTests = false) {
  const secret = random();
  const deviceKeys = { 'hatchai-inc01-controller': { key1: secret } };
  // Deliberately misconfigured, ephemeral in-memory keys for role-denial tests only.
  if (negativeRoleTests) for (const cameraId of ['hatchai-inc01-cam01', 'hatchai-inc01-cam02']) {
    deviceKeys[cameraId] = { key1: random() };
  }
  const options = {
    modulesRoot: fileURLToPath(new URL('../src/', import.meta.url)),
    modules: ['index.js', 'pairing.js', 'security.js', 'retention.js', 'test-notification.js', 'online-api.js', 'supabase-session.js'].map(name => ({
      type: 'ESModule', path: fileURLToPath(new URL('../src/' + name, import.meta.url))
    })),
    compatibilityDate: config.compatibility_date,
    d1Databases: { DB: 'hatchai-isolated-hardening-test' }, d1Persist: false,
    bindings: { PAIRING_HASH_KEY: random(), NOTIFICATION_DEVICE_KEYS: JSON.stringify(deviceKeys) },
    ratelimits: Object.fromEntries(config.ratelimits.map(b => [b.name, { namespace_id: b.namespace_id, simple: b.simple }]))
  };
  // Each scenario has its own runtime, temporary DB and unmodified native budgets.
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  try {
    const db = await mf.getD1Database('DB');
    await db.prepare(`CREATE TABLE push_tokens(id TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,device_name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
    for (const name of ['0001_pairing.sql', '0002_retention_indexes.sql']) {
      const sql = readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8');
      await db.batch(sql.replace(/^--.*$/gm, '').split(';').filter(s => s.trim()).map(s => db.prepare(s)));
    }
    // Canary is never used by pairing. Every scenario verifies preservation.
    await db.prepare("INSERT INTO push_tokens(id,token,device_name) VALUES('legacy','legacy-canary','untouched')").run();
    const canary = await db.prepare("SELECT * FROM push_tokens WHERE id='legacy'").first();
    async function post(path, body, browser = false) {
      requests++;
      const r = await mf.dispatchFetch('http://localhost' + path, { method: 'POST', headers: {
        'Content-Type': 'application/json', ...(browser ? { Origin: 'https://hatchai-8d34c.web.app' } : {})
      }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    }
    async function device(path, fields) {
      const body = { deviceId: 'hatchai-inc01-controller', keyId: 'key1', ...fields };
      body.signature = b64(await crypto.subtle.sign('HMAC', await hmacKey(secret), await signingMessage(path, body)));
      return post(path, body);
    }
    async function deviceAs(deviceId, path, fields) {
      const body = { deviceId, keyId: 'key1', ...fields };
      const testSecret = deviceKeys[deviceId]?.key1 || random();
      body.signature = b64(await crypto.subtle.sign('HMAC', await hmacKey(testSecret), await signingMessage(path, body)));
      return post(path, body);
    }
    async function challenge(operation) {
      const r = await device('/device/pairing/challenge', { operation, requestId: random(), issuedAt: Math.floor(Date.now() / 1000) });
      assert.equal(r.status, 200); return r.body;
    }
    async function start() {
      const r = await device('/device/pairing/start', await challenge('start')); assert.equal(r.status, 200); return r.body;
    }
    async function phone() {
      const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      return { publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey), async sign(path, fields) {
        const b = { ...fields };
        b.signature = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, await signingMessage(path, b)));
        return b;
      } };
    }
    async function redeem(pair, p) {
      return post('/pairing/redeem', await p.sign('/pairing/redeem', { code: pair.code, publicKey: p.publicKey }), true);
    }
    async function enroll() {
      const pair = await start(), p = await phone(), g = await redeem(pair, p); assert.equal(g.status, 200);
      const token = 'runtime_' + random();
      const r = await post('/register', await p.sign('/register', { ...g.body, token }), true); assert.equal(r.status, 200);
      return { pair, phone: p, token, registration: r.body };
    }
    async function management(e) {
      return post('/registration/challenge', await e.phone.sign('/registration/challenge', {
        registrationId: e.registration.registrationId, requestId: random(), issuedAt: Math.floor(Date.now() / 1000)
      }), true);
    }
    async function owners() {
      return (await db.prepare('SELECT COUNT(*) AS n FROM push_registration_auth').first()).n;
    }
    await run({ mf, db, post, device, deviceAs, challenge, start, phone, redeem, enroll, management, owners });
    assert.deepEqual(await db.prepare("SELECT * FROM push_tokens WHERE id='legacy'").first(), canary);
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
    cases++; console.log('PASS workerd/D1:', name);
  } finally { await mf.dispose(); }
}

await scenario('cancel versus redeem', async s => {
  const pair = await s.start(), p = await s.phone(), c = await s.challenge('cancel');
  const [cancel, redeem] = await Promise.all([
    s.device('/device/pairing/cancel', { ...c, pairingId: pair.pairingId }), s.redeem(pair, p)
  ]);
  assert.equal(cancel.status, 200);
  assert.equal((await s.db.prepare('SELECT state FROM pairing_sessions WHERE id=?').bind(pair.pairingId).first()).state, 'cancelled');
  if (redeem.status === 200) assert.equal((await s.post('/register', await p.sign('/register', {
    ...redeem.body, token: 'cancelled_' + random()
  }), true)).status, 409);
  assert.equal(await s.owners(), 0);
});
await scenario('cancel versus register', async s => {
  const pair = await s.start(), p = await s.phone(), g = await s.redeem(pair, p), c = await s.challenge('cancel');
  const body = await p.sign('/register', { ...g.body, token: 'race_' + random() });
  await Promise.all([s.device('/device/pairing/cancel', { ...c, pairingId: pair.pairingId }), s.post('/register', body, true)]);
  const state = (await s.db.prepare('SELECT state FROM pairing_sessions WHERE id=?').bind(pair.pairingId).first()).state;
  assert.ok(['registered', 'cancelled'].includes(state));
  assert.equal(await s.owners(), state === 'registered' ? 1 : 0);
  const tokens = await s.db.prepare("SELECT COUNT(*) AS n FROM push_tokens WHERE id<>'legacy'").first();
  assert.equal(tokens.n, await s.owners());
});
await scenario('simultaneous starts with different challenges', async s => {
  const a = await s.challenge('start'), b = await s.challenge('start');
  const results = await Promise.all([s.device('/device/pairing/start', a), s.device('/device/pairing/start', b)]);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 1);
});
for (const path of ['/registration/refresh', '/unregister']) {
  for (const expired of [false, true]) {
    await scenario(`challenge renewal versus ${path}, ${expired ? 'expired' : 'live'} nonce`, async s => {
      const e = await s.enroll(), c = await s.management(e); assert.equal(c.status, 200);
      if (expired) await s.db.prepare('UPDATE push_registration_auth SET nonce_expires_at=unixepoch()-1').run();
      const body = await e.phone.sign(path, { registrationId: e.registration.registrationId,
        nonce: c.body.nonce, version: c.body.version, ...(path.endsWith('refresh') ? { token: e.token } : {}) });
      const [renewal, mutation] = await Promise.all([s.management(e), s.post(path, body, true)]);
      assert.ok([200, 401].includes(renewal.status)); assert.equal(mutation.status, expired ? 409 : 200);
      const row = await s.db.prepare('SELECT * FROM push_registration_auth').first();
      assert.equal(row.version, expired ? 0 : 1);
      assert.equal(row.revoked_at !== null, !expired && path === '/unregister');
      assert.notEqual((await s.post(path, body, true)).status, 200);
    });
  }
}
await scenario('expiry boundary, cancelled requests and duplicate redemption', async s => {
  const pair = await s.start(), p = await s.phone();
  // Real DB clock: equality is expired, as is any later execution second.
  await s.db.prepare('UPDATE pairing_sessions SET code_issued_at=unixepoch()-300,code_expires_at=unixepoch() WHERE id=?').bind(pair.pairingId).run();
  assert.equal((await s.redeem(pair, p)).status, 401);
  const next = await s.start(), g = await s.redeem(next, p); assert.equal(g.status, 200);
  assert.equal((await s.redeem(next, p)).status, 401);
  const c = await s.challenge('cancel');
  const fields = { ...c, pairingId: next.pairingId };
  assert.equal((await s.device('/device/pairing/cancel', fields)).status, 200);
  assert.notEqual((await s.device('/device/pairing/cancel', fields)).status, 200);
  assert.equal((await s.redeem(next, p)).status, 401);
});
await scenario('native status budget exhaustion does not block cancellation', async s => {
  const pair = await s.start();
  let limited = false;
  // Allow for a minute-boundary reset; this tests rejection, not an exact quota.
  for (let i = 0; i < 360; i++) {
    const r = await s.device('/device/pairing/challenge', { operation: 'status', requestId: random(), issuedAt: Math.floor(Date.now() / 1000) });
    if (r.status === 429) { limited = true; break; }
    assert.equal(r.status, 200);
  }
  assert.ok(limited);
  const c = await s.challenge('cancel');
  assert.equal((await s.device('/device/pairing/cancel', { ...c, pairingId: pair.pairingId })).status, 200);
});
await scenario('scheduled retention and nonce retirement preserve active registration recovery', async s => {
  const e = await s.enroll();
  await s.db.prepare('UPDATE pairing_sessions SET registered_at=unixepoch()-691200 WHERE id=?').bind(e.pair.pairingId).run();
  await s.db.prepare('UPDATE push_registration_auth SET nonce_expires_at=unixepoch()-1').run();
  await s.db.prepare(`INSERT INTO pairing_sessions
    (id,device_id,device_key_id,state,device_challenge,challenge_expires_at,created_at,updated_at)
    VALUES(?,'runtime','key1','cancelled',?,unixepoch()-99999,unixepoch()-200000,unixepoch()-100000)`)
    .bind(random(), random()).run();
  const worker = await s.mf.getWorker();
  const result = await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
  assert.equal(result.outcome, 'ok');
  const rows = await s.db.prepare('SELECT state FROM pairing_sessions').all();
  assert.equal(rows.results.length, 1); assert.equal(rows.results[0].state, 'registered');
  const auth = await s.db.prepare('SELECT * FROM push_registration_auth').first();
  assert.equal(auth.nonce_expires_at, 0); assert.equal(auth.version, 1);
  const response = await s.post('/registration/challenge', await e.phone.sign('/registration/challenge', {
    pairingId: e.pair.pairingId, requestId: random(), issuedAt: Math.floor(Date.now() / 1000)
  }), true);
  assert.equal(response.status, 200); assert.equal(response.body.registrationId, e.registration.registrationId);
});
await scenario('both cameras denied all controller pairing operations despite valid test credentials', async s => {
  const pair = await s.start(), start = await s.challenge('start'), status = await s.challenge('status'), cancel = await s.challenge('cancel');
  const targets = [
    ['/device/pairing/challenge', { operation: 'start', requestId: random(), issuedAt: Math.floor(Date.now() / 1000) }],
    ['/device/pairing/start', start],
    ['/device/pairing/status', { ...status, pairingId: pair.pairingId }],
    ['/device/pairing/cancel', { ...cancel, pairingId: pair.pairingId }]
  ];
  for (const cameraId of ['hatchai-inc01-cam01', 'hatchai-inc01-cam02']) {
    for (const [path, fields] of targets) {
      const r = await s.deviceAs(cameraId, path, { ...fields, role: 'controller' });
      assert.equal(r.status, 403); assert.ok(!r.body.code && !r.body.grant);
    }
  }
  const fields = { operation: 'start', requestId: random(), issuedAt: Math.floor(Date.now() / 1000) };
  assert.equal((await s.deviceAs('unknown-board', '/device/pairing/challenge', fields)).status, 401);
  assert.equal((await s.deviceAs('hatchai-inc01-cam01', '/device/pairing/challenge', {
    ...fields, deviceId: 'hatchai-inc01-controller'
  })).status, 401);
  assert.equal((await s.db.prepare('SELECT state FROM pairing_sessions WHERE id=?').bind(pair.pairingId).first()).state, 'issued');
  // Camera attempts did not consume the real controller's challenges.
  assert.equal((await s.device('/device/pairing/status', { ...status, pairingId: pair.pairingId })).status, 200);
  assert.equal((await s.device('/device/pairing/cancel', { ...cancel, pairingId: pair.pairingId })).body.state, 'cancelled');
}, true);
console.log(`workerd/D1 hardening passed: ${cases} scenarios, ${requests} requests; native budgets, required races, cron retention, board roles and legacy-record preservation`);
