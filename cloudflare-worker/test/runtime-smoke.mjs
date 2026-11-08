// Optional isolated workerd/D1 integration. Uses installed/cached Miniflare;
// no package downloads, account credentials, Wrangler state or remote bindings.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { random, b64, hmacKey, signingMessage } from '../src/security.js';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require(process.env.HATCHAI_MINIFLARE || 'miniflare');
const secret = random();
const options = {
  modulesRoot: fileURLToPath(new URL('../src/', import.meta.url)),
  modules: ['index.js', 'pairing.js', 'security.js', 'retention.js'].map(name => ({
    type: 'ESModule', path: fileURLToPath(new URL('../src/' + name, import.meta.url))
  })),
  compatibilityDate: '2026-11-07',
  d1Databases: { DB: 'hatchai-isolated-pairing-test' },
  d1Persist: false,
  bindings: { PAIRING_HASH_KEY: random(), NOTIFICATION_DEVICE_KEYS: JSON.stringify({ 'hatchai-inc01-controller': { key1: secret } }) },
  ratelimits: Object.fromEntries(JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))
    .ratelimits.map(b => [b.name, { namespace_id: b.namespace_id, simple: b.simple }]))
};
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
try {
  const db = await mf.getD1Database('DB');
  await db.prepare(`CREATE TABLE push_tokens(id TEXT PRIMARY KEY,token TEXT NOT NULL UNIQUE,device_name TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();
  for (const name of ['0001_pairing.sql', '0002_retention_indexes.sql']) {
    const migration = readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8');
    await db.batch(migration.replace(/^--.*$/gm, '').split(';').filter(s => s.trim()).map(s => db.prepare(s)));
  }
  let calls = 0;
  async function post(path, body, browser = false) {
    calls++;
    const response = await mf.dispatchFetch('http://localhost' + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(browser ? { Origin: 'https://hatchai-8d34c.web.app' } : {}) },
      body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  async function device(path, fields) {
    const body = { deviceId: 'hatchai-inc01-controller', keyId: 'key1', ...fields };
    body.signature = b64(await crypto.subtle.sign('HMAC', await hmacKey(secret), await signingMessage(path, body)));
    return post(path, body);
  }
  async function challenge(operation) {
    const r = await device('/device/pairing/challenge', { operation, requestId: random(), issuedAt: Math.floor(Date.now() / 1000) });
    assert.equal(r.status, 200); return r.body;
  }
  async function start() {
    const r = await device('/device/pairing/start', await challenge('start'));
    assert.equal(r.status, 200); return r.body;
  }
  async function phone() {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    return { publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey), async sign(path, fields) {
      const body = { ...fields };
      body.signature = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, await signingMessage(path, body)));
      return body;
    } };
  }
  const root = await mf.dispatchFetch('http://localhost/'); assert.equal(root.status, 200);
  const pair = await start(), a = await phone(), b = await phone();
  const redeems = await Promise.all([a, b].map(async p => ({ phone: p,
    result: await post('/pairing/redeem', await p.sign('/pairing/redeem', { code: pair.code, publicKey: p.publicKey }), true) })));
  assert.equal(redeems.filter(r => r.result.status === 200).length, 1);
  const winner = redeems.find(r => r.result.status === 200);
  const token = 'runtime_' + random();
  const registrationBody = await winner.phone.sign('/register', { ...winner.result.body, token });
  const registrations = await Promise.all([post('/register', registrationBody, true), post('/register', registrationBody, true)]);
  assert.equal(registrations.filter(r => r.status === 200).length, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_tokens').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_registration_auth').first()).n, 1);
  const registration = registrations.find(r => r.status === 200).body;
  const lost = await post('/registration/challenge', await winner.phone.sign('/registration/challenge', {
    pairingId: pair.pairingId, requestId: random(), issuedAt: Math.floor(Date.now() / 1000)
  }), true);
  assert.equal(lost.status, 200); assert.equal(lost.body.registrationId, registration.registrationId);
  const refresh = await winner.phone.sign('/registration/refresh', { registrationId: registration.registrationId,
    nonce: lost.body.nonce, version: lost.body.version, token });
  const refreshes = await Promise.all([post('/registration/refresh', refresh, true), post('/registration/refresh', refresh, true)]);
  assert.equal(refreshes.filter(r => r.status === 200).length, 1);
  const secondPair = await start(), secondPhone = await phone();
  const g = await post('/pairing/redeem', await secondPhone.sign('/pairing/redeem', { code: secondPair.code, publicKey: secondPhone.publicKey }), true);
  assert.equal(g.status, 200);
  const duplicate = await post('/register', await secondPhone.sign('/register', { ...g.body, token }), true);
  assert.equal(duplicate.status, 409);
  assert.equal((await db.prepare('SELECT state FROM pairing_sessions WHERE id=?').bind(secondPair.pairingId).first()).state, 'redeemed');
  const fresh = await post('/register', await secondPhone.sign('/register', { ...g.body, token: 'second_' + random() }), true);
  assert.equal(fresh.status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_tokens').first()).n, 2);
  const foreign = await db.prepare('PRAGMA foreign_key_check').all(); assert.equal(foreign.results.length, 0);
  assert.equal((await post('/chick-detected', {})).status, 503);
  console.log(`workerd/D1 integration passed: ${calls} requests; real rate bindings, concurrent redemption/registration/refresh, duplicate rollback, lost response, two owners, FK integrity, delivery disabled`);
} finally { await mf.dispose(); }
