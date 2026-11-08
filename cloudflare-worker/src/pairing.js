import { ApiError, need, random, protectedHash, verifyController, verifyBrowser,
  publicKey, pairingCode, readBody, deviceSecret, requireControllerRole } from './security.js';

const ORIGIN = 'https://hatchai-8d34c.web.app';
const DAY90 = 90 * 86400;
const browserPaths = new Set(['/pairing/redeem', '/register', '/registration/challenge', '/registration/refresh', '/unregister']);
const devicePaths = new Set(['/device/pairing/challenge', '/device/pairing/start', '/device/pairing/status', '/device/pairing/cancel']);
const now = () => Math.floor(Date.now() / 1000);
const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const changes = r => Number(r.meta?.changes);
function id(value) { need(typeof value === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(value)); return value; }
function freshness(body) {
  id(body.requestId);
  need(Number.isSafeInteger(body.issuedAt) && Math.abs(now() - body.issuedAt) <= 60, 401, 'Expired request');
}
async function limit(env, binding, key) {
  need(env[binding]?.limit, 503, 'Rate limiter unavailable');
  need((await env[binding].limit({ key })).success, 429, 'Too many requests');
}
function liveDevice(env, row) {
  deviceSecret(env, row.device_id, row.device_key_id);
  requireControllerRole(row.device_id);
}
function tokenInput(body) {
  need(typeof body.token === 'string' && /^[A-Za-z0-9_:.-]{20,4096}$/.test(body.token));
  need(body.deviceName === undefined || (typeof body.deviceName === 'string' &&
    body.deviceName.length <= 80 && !/[\x00-\x1f\x7f]/.test(body.deviceName)));
}
async function pairingChallenge(env, b) {
  freshness(b); need(['start', 'status', 'cancel'].includes(b.operation));
  const challenge = b.operation + ':' + random();
  await stmt(env, `INSERT INTO pairing_sessions
    (id,device_id,device_key_id,device_challenge,challenge_expires_at,created_at,updated_at)
    VALUES(?,?,?,?,unixepoch()+60,unixepoch(),unixepoch())`,
  b.requestId, b.deviceId, b.keyId, challenge).run();
  return { sessionId: b.requestId, challenge, expiresIn: 60 };
}
async function deviceOperation(env, path, b) {
  id(b.sessionId);
  const operation = path.split('/').at(-1);
  const c = await stmt(env, `SELECT * FROM pairing_sessions WHERE id=? AND device_id=? AND device_key_id=?`,
    b.sessionId, b.deviceId, b.keyId).first();
  need(c && c.state === 'challenge' && c.challenge_expires_at > now() &&
    c.device_challenge === b.challenge && c.device_challenge.startsWith(operation + ':'), 401, 'Invalid challenge');
  if (operation === 'start') {
    const code = pairingCode(), hash = await protectedHash(env, 'code', code);
    const results = await env.DB.batch([
      stmt(env, `UPDATE pairing_sessions SET state='expired',code_hash=NULL,grant_hash=NULL,updated_at=unixepoch()
        WHERE device_id=? AND ((state='issued' AND code_expires_at<=unixepoch()) OR
        (state='redeemed' AND grant_expires_at<=unixepoch()))`, b.deviceId),
      stmt(env, `UPDATE pairing_sessions SET state='issued',code_hash=?,code_issued_at=unixepoch(),
        code_expires_at=unixepoch()+300,updated_at=unixepoch()
        WHERE id=? AND state='challenge' AND challenge_expires_at>unixepoch() AND device_challenge=?`, hash, b.sessionId, b.challenge)
    ]);
    need(changes(results[1]) === 1, 409, 'Challenge already used');
    // Device-only response: all Origin-bearing requests are rejected upstream.
    return { pairingId: b.sessionId, code, expiresIn: 300 };
  }
  id(b.pairingId); need(b.pairingId !== b.sessionId);
  const fence = random();
  const claim = stmt(env, `UPDATE pairing_sessions SET state='cancelled',registration_attempt_id=?,updated_at=unixepoch()
    WHERE id=? AND state='challenge' AND challenge_expires_at>unixepoch() AND device_challenge=?`, fence, b.sessionId, b.challenge);
  const gate = `EXISTS(SELECT 1 FROM pairing_sessions c WHERE c.id=? AND c.registration_attempt_id=?)`;
  const queries = [claim];
  if (operation === 'cancel') queries.push(stmt(env, `UPDATE pairing_sessions SET state='cancelled',code_hash=NULL,
    grant_hash=NULL,updated_at=unixepoch() WHERE id=? AND device_id=? AND state IN ('issued','redeemed') AND ${gate}`,
  b.pairingId, b.deviceId, b.sessionId, fence));
  queries.push(stmt(env, `SELECT state,code_expires_at,grant_expires_at FROM pairing_sessions
    WHERE id=? AND device_id=? AND ${gate}`, b.pairingId, b.deviceId, b.sessionId, fence));
  const results = await env.DB.batch(queries);
  need(changes(results[0]) === 1, 409, 'Challenge already used');
  const row = results.at(-1).results[0]; need(row, 404, 'Pairing unavailable');
  const expired = row.state === 'issued' && row.code_expires_at <= now() || row.state === 'redeemed' && row.grant_expires_at <= now();
  return { pairingId: b.pairingId, state: expired ? 'expired' : row.state };
}
async function redeem(env, b) {
  need(typeof b.code === 'string' && b.code.length <= 24);
  const code = b.code.toUpperCase().replaceAll('-', ''); need(/^[A-Z2-7]{16}$/.test(code));
  const hash = await protectedHash(env, 'code', code);
  const pair = await stmt(env, `SELECT * FROM pairing_sessions WHERE code_hash=? AND state='issued'`, hash).first();
  need(pair, 401, 'Pairing unavailable'); liveDevice(env, pair);
  const pub = await publicKey(b.publicKey);
  await verifyBrowser(b.publicKey, '/pairing/redeem', b);
  const grant = random(), grantHash = await protectedHash(env, 'grant', grant);
  const row = await stmt(env, `UPDATE pairing_sessions SET state='redeemed',browser_public_key_jwk=?,grant_hash=?,
    grant_expires_at=unixepoch()+300,redeemed_at=unixepoch(),updated_at=unixepoch(),code_hash=NULL
    WHERE id=? AND code_hash=? AND state='issued' AND code_expires_at>unixepoch() RETURNING id`,
  pub.json, grantHash, pair.id, hash).first();
  need(row, 401, 'Pairing unavailable');
  return { pairingId: row.id, grant, expiresIn: 300 };
}
async function register(env, b) {
  id(b.pairingId); id(b.grant); tokenInput(b);
  const pair = await stmt(env, `SELECT * FROM pairing_sessions WHERE id=?`, b.pairingId).first();
  need(pair?.browser_public_key_jwk, 401, 'Unauthorized'); liveDevice(env, pair);
  await verifyBrowser(JSON.parse(pair.browser_public_key_jwk), '/register', b);
  const grantHash = await protectedHash(env, 'grant', b.grant);
  const registrationId = random(), attempt = random(), nonce = random();
  const results = await env.DB.batch([
    stmt(env, `UPDATE pairing_sessions SET state='registered',registration_attempt_id=?,registered_at=unixepoch(),
      updated_at=unixepoch(),grant_hash=NULL WHERE id=? AND state='redeemed' AND grant_hash=? AND grant_expires_at>unixepoch()
      AND browser_public_key_jwk=?`, attempt, b.pairingId, grantHash, pair.browser_public_key_jwk),
    stmt(env, `INSERT INTO push_tokens(id,token,device_name,enabled) SELECT ?,?,?,1 FROM pairing_sessions
      WHERE id=? AND state='registered' AND registration_attempt_id=?`, registrationId, b.token, b.deviceName || null, b.pairingId, attempt),
    stmt(env, `INSERT INTO push_registration_auth(registration_id,pairing_session_id,device_id,device_key_id,
      browser_public_key_jwk,request_nonce,nonce_expires_at,version,authorized_until,created_at,updated_at)
      SELECT ?,id,device_id,device_key_id,browser_public_key_jwk,?,unixepoch()+60,0,unixepoch()+?,unixepoch(),unixepoch()
      FROM pairing_sessions WHERE id=? AND state='registered' AND registration_attempt_id=?`, registrationId, nonce, DAY90, b.pairingId, attempt),
    stmt(env, `SELECT a.registration_id,a.authorized_until FROM push_registration_auth a JOIN push_tokens t ON t.id=a.registration_id
      JOIN pairing_sessions p ON p.id=a.pairing_session_id WHERE a.registration_id=? AND p.registration_attempt_id=? AND t.enabled=1`, registrationId, attempt)
  ]);
  need(results.slice(0, 3).every(r => changes(r) === 1) && results[3].results.length === 1, 409, 'Authorization already used');
  return { registered: true, registrationId, authorizedUntil: results[3].results[0].authorized_until };
}
async function manage(env, path, b) {
  // A lost register response is reconciled using pairing ID + proof of the bound private key.
  need(Boolean(b.registrationId) !== Boolean(b.pairingId));
  if (b.pairingId) need(path === '/registration/challenge');
  const field = b.registrationId ? 'registration_id' : 'pairing_session_id';
  const lookup = id(b.registrationId || b.pairingId);
  const auth = await stmt(env, `SELECT * FROM push_registration_auth WHERE ${field}=?`, lookup).first();
  need(auth && auth.revoked_at === null && auth.authorized_until > now(), 401, 'Unauthorized');
  liveDevice(env, auth); await verifyBrowser(JSON.parse(auth.browser_public_key_jwk), path, b);
  // Separate keys per operation: challenge requests cannot starve unregister.
  await limit(env, 'REGISTRATION_LIMITER', `owner:${path}:${auth.registration_id}`);
  if (path === '/registration/challenge') {
    freshness(b);
    await stmt(env, `UPDATE push_registration_auth SET request_nonce=?,nonce_expires_at=unixepoch()+60
      WHERE registration_id=? AND nonce_expires_at<=unixepoch() AND revoked_at IS NULL AND authorized_until>unixepoch()`, random(), auth.registration_id).run();
    const current = await stmt(env, `SELECT registration_id,request_nonce,nonce_expires_at,version,authorized_until
      FROM push_registration_auth WHERE registration_id=? AND revoked_at IS NULL AND authorized_until>unixepoch()`, auth.registration_id).first();
    need(current, 401, 'Unauthorized');
    return { registrationId: current.registration_id, nonce: current.request_nonce,
      expiresAt: current.nonce_expires_at, version: current.version, authorizedUntil: current.authorized_until };
  }
  need(Number.isSafeInteger(b.version) && b.version >= 0); id(b.nonce);
  if (path === '/registration/refresh') tokenInput(b);
  const nextNonce = random(), revoked = path === '/unregister';
  const gate = `EXISTS(SELECT 1 FROM push_registration_auth a WHERE a.registration_id=? AND a.request_nonce=? AND a.version=?)`;
  const results = await env.DB.batch([
    stmt(env, `UPDATE push_registration_auth SET request_nonce=?,nonce_expires_at=unixepoch()+60,version=version+1,
      revoked_at=CASE WHEN ? THEN unixepoch() ELSE NULL END,updated_at=unixepoch()
      WHERE registration_id=? AND request_nonce=? AND version=? AND nonce_expires_at>unixepoch()
      AND revoked_at IS NULL AND authorized_until>unixepoch()`, nextNonce, revoked ? 1 : 0, auth.registration_id, b.nonce, b.version),
    revoked ? stmt(env, `UPDATE push_tokens SET enabled=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${gate}`,
      auth.registration_id, auth.registration_id, nextNonce, b.version + 1) :
      stmt(env, `UPDATE push_tokens SET token=?,device_name=COALESCE(?,device_name),updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND ${gate}`, b.token, b.deviceName ?? null, auth.registration_id, auth.registration_id, nextNonce, b.version + 1)
  ]);
  need(results.every(r => changes(r) === 1), 409, 'Expired or consumed authorization');
  return { success: true, registrationId: auth.registration_id, version: b.version + 1 };
}

export async function pairingFetch(request, env) {
  const url = new URL(request.url), path = url.pathname, origin = request.headers.get('Origin');
  const json = (data, status = 200) => Response.json(data, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin',
    ...(origin === ORIGIN && browserPaths.has(path) ? { 'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600' } : {})
  } });
  try {
    need(browserPaths.has(path) || devicePaths.has(path), 404, 'Endpoint not found');
    need(!url.search, 400, 'URL parameters are not accepted');
    need(url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 400, 'HTTPS required');
    if (browserPaths.has(path)) need(origin === ORIGIN, 403, 'Origin not allowed');
    else need(!origin, 403, 'Device endpoint');
    if (request.method === 'OPTIONS' && browserPaths.has(path)) return json({});
    need(request.method === 'POST', 405, 'POST required');
    const body = await readBody(request);
    const ip = request.headers.get('CF-Connecting-IP') || 'local';
    if (devicePaths.has(path)) {
      const operation = path.endsWith('/challenge') ? body.operation : path.split('/').at(-1);
      need(['start', 'status', 'cancel'].includes(operation));
      const binding = operation === 'status' ? 'DEVICE_STATUS_LIMITER' :
        operation === 'cancel' ? 'DEVICE_CANCEL_LIMITER' : 'DEVICE_PAIRING_LIMITER';
      await limit(env, binding, `ip:${ip}`);
      await verifyController(env, path, body);
      await limit(env, binding, `device:${body.deviceId}`);
      return json(path.endsWith('/challenge') ? await pairingChallenge(env, body) : await deviceOperation(env, path, body));
    }
    const binding = path === '/pairing/redeem' ? 'BROWSER_REDEEM_LIMITER' :
      path === '/register' ? 'BROWSER_REGISTER_LIMITER' : 'REGISTRATION_LIMITER';
    await limit(env, binding, `ip:${path}:${ip}`);
    if (path === '/pairing/redeem') return json(await redeem(env, body));
    if (path === '/register') return json(await register(env, body));
    return json(await manage(env, path, body));
  } catch (error) {
    if (error instanceof ApiError) return json({ success: false, message: error.message }, error.status);
    // Do not echo/log database exceptions; they can contain token-bearing details.
    if (/UNIQUE constraint failed/.test(String(error?.message))) return json({ success: false, message: 'Registration or pairing conflict' }, 409);
    return json({ success: false, message: 'Service unavailable' }, 503);
  }
}
