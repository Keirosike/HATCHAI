var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/security.js
var encoder = new TextEncoder();
var DEVICE_ROLES = Object.freeze({
  "hatchai-inc01-controller": "controller",
  "hatchai-inc01-cam01": "camera",
  "hatchai-inc01-cam02": "camera"
});
var ApiError = class extends Error {
  static {
    __name(this, "ApiError");
  }
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function need(value, status = 400, message = "Invalid request") {
  if (!value) throw new ApiError(status, message);
}
__name(need, "need");
function random(bytes = 32) {
  return b64(crypto.getRandomValues(new Uint8Array(bytes)));
}
__name(random, "random");
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
__name(b64, "b64");
function unb64(value) {
  need(typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value));
  try {
    return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
  } catch {
    throw new ApiError(400, "Invalid encoding");
  }
}
__name(unb64, "unb64");
async function sha(value) {
  return b64(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
__name(sha, "sha");
async function hmacKey(secret) {
  const bytes = unb64(secret);
  need(bytes.length === 32, 503, "Security configuration unavailable");
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
__name(hmacKey, "hmacKey");
async function protectedHash(env, purpose, value) {
  need(env.PAIRING_HASH_KEY, 503, "Security configuration unavailable");
  return b64(await crypto.subtle.sign(
    "HMAC",
    await hmacKey(env.PAIRING_HASH_KEY),
    encoder.encode(`${purpose}
${value}`)
  ));
}
__name(protectedHash, "protectedHash");
async function signingMessage(path, body) {
  const unsigned = { ...body };
  delete unsigned.signature;
  return encoder.encode(`HATCHAI-NOTIFY-v1
POST
${path}
${await sha(canonical(unsigned))}`);
}
__name(signingMessage, "signingMessage");
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
__name(canonical, "canonical");
function deviceSecret(env, deviceId, keyId) {
  need(typeof deviceId === "string" && /^[\w-]{1,64}$/.test(deviceId));
  need(typeof keyId === "string" && /^[\w-]{1,64}$/.test(keyId));
  let devices;
  try {
    devices = JSON.parse(env.NOTIFICATION_DEVICE_KEYS || "{}");
  } catch {
    throw new ApiError(503, "Security configuration unavailable");
  }
  const entry = Object.hasOwn(devices, deviceId) ? devices[deviceId] : null;
  const key = entry && Object.hasOwn(entry, keyId) ? entry[keyId] : null;
  need(typeof key === "string", 401, "Unauthorized");
  return key;
}
__name(deviceSecret, "deviceSecret");
async function verifyDevice(env, path, body) {
  const key = await hmacKey(deviceSecret(env, body.deviceId, body.keyId));
  need(typeof body.signature === "string", 401, "Unauthorized");
  need(await crypto.subtle.verify("HMAC", key, unb64(body.signature), await signingMessage(path, body)), 401, "Unauthorized");
}
__name(verifyDevice, "verifyDevice");
function requireControllerRole(deviceId) {
  need(
    Object.hasOwn(DEVICE_ROLES, deviceId) && DEVICE_ROLES[deviceId] === "controller",
    403,
    "Controller pairing only"
  );
}
__name(requireControllerRole, "requireControllerRole");
async function verifyController(env, path, body) {
  await verifyDevice(env, path, body);
  requireControllerRole(body.deviceId);
}
__name(verifyController, "verifyController");
async function publicKey(jwk) {
  need(jwk && jwk.kty === "EC" && jwk.crv === "P-256" && !jwk.d && typeof jwk.x === "string" && typeof jwk.y === "string");
  need(unb64(jwk.x).length === 32 && unb64(jwk.y).length === 32);
  const clean = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
  try {
    const key = await crypto.subtle.importKey("jwk", clean, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return { key, json: canonical(clean) };
  } catch {
    throw new ApiError(400, "Invalid browser key");
  }
}
__name(publicKey, "publicKey");
async function verifyBrowser(jwk, path, body) {
  const imported = await publicKey(jwk);
  need(typeof body.signature === "string", 401, "Unauthorized");
  const signature = unb64(body.signature);
  need(signature.length === 64 && await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    imported.key,
    signature,
    await signingMessage(path, body)
  ), 401, "Unauthorized");
}
__name(verifyBrowser, "verifyBrowser");
function pairingCode() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => alphabet[n & 31]).join("");
}
__name(pairingCode, "pairingCode");
async function readBody(request) {
  need(request.headers.get("Content-Type")?.split(";")[0].trim() === "application/json", 415, "JSON required");
  const reader = request.body?.getReader();
  need(reader);
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) {
      await reader.cancel();
      throw new ApiError(413, "Request too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
  need(body && typeof body === "object" && !Array.isArray(body));
  return body;
}
__name(readBody, "readBody");

// src/test-notification.js
var TEST_NOTIFICATION = Object.freeze({
  title: "HATCHAI Test Notification",
  body: "Your HATCHAI notification system is working."
});
var PROJECT = "hatchai-8d34c";
var OAUTH = "https://oauth2.googleapis.com/token";
var encoder2 = new TextEncoder();
var sessions = /* @__PURE__ */ new WeakMap();
async function googleJson(url, options, deadline) {
  try {
    if (Date.now() >= deadline) throw new Error("Deadline");
    const response = await fetch(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(Math.min(8e3, deadline - Date.now())) });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("Provider redirect rejected");
    }
    const reader = response.body?.getReader();
    need(reader, 502, "Notification provider unavailable");
    const chunks = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new Error("Oversized provider response");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let body;
    try {
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  } catch {
    throw new ApiError(502, "Test request outcome is unknown. Check this phone before sending another test.");
  }
}
__name(googleJson, "googleJson");
async function prepareTestDelivery(env) {
  need(env.MANUAL_TEST_NOTIFICATIONS_ENABLED === "true", 503, "Manual test notifications are disabled");
  return prepareDelivery(env, false);
}
__name(prepareTestDelivery, "prepareTestDelivery");
async function prepareDelivery(env, cloud) {
  need(typeof env.FCM_SERVICE_ACCOUNT_JSON === "string", 503, "Test notification configuration unavailable");
  let session = sessions.get(env);
  if (!session || session.source !== env.FCM_SERVICE_ACCOUNT_JSON) {
    try {
      const account = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
      need(account.type === "service_account" && account.project_id === PROJECT && typeof account.client_email === "string" && /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(account.client_email) && (!account.token_uri || account.token_uri === OAUTH) && typeof account.private_key === "string");
      const match = /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----\s*$/.exec(account.private_key);
      need(match && match[1].length <= 16384);
      const der = Uint8Array.from(atob(match[1].replace(/\s/g, "")), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
      need(key.algorithm.modulusLength >= 2048);
      session = { source: env.FCM_SERVICE_ACCOUNT_JSON, email: account.client_email, key, access: null, pending: null };
      sessions.set(env, session);
    } catch {
      throw new ApiError(503, "Test notification configuration unavailable");
    }
  }
  return async (token, content) => {
    const deadline = Date.now() + 1e4;
    const now2 = Math.floor(Date.now() / 1e3);
    if (!session.access || session.access.expires <= now2 + 60) {
      if (!session.pending) session.pending = (async () => {
        const header = b64(encoder2.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
        const claims = b64(encoder2.encode(JSON.stringify({
          iss: session.email,
          scope: "https://www.googleapis.com/auth/firebase.messaging",
          aud: OAUTH,
          iat: now2,
          exp: now2 + 3600
        })));
        const unsigned = `${header}.${claims}`;
        const signature = b64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", session.key, encoder2.encode(unsigned)));
        const response2 = await googleJson(OAUTH, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` })
        }, deadline);
        need(
          response2.ok && typeof response2.body?.access_token === "string" && response2.body.access_token.length <= 4096 && Number.isSafeInteger(response2.body.expires_in) && response2.body.expires_in >= 120 && response2.body.expires_in <= 3600,
          502,
          "Notification provider authorization failed"
        );
        session.access = { token: response2.body.access_token, expires: now2 + response2.body.expires_in };
      })().finally(() => {
        session.pending = null;
      });
      await session.pending;
    }
    const response = await googleJson(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access.token}` },
      body: JSON.stringify({ message: {
        token,
        notification: cloud ? { title: content.title, body: content.body } : TEST_NOTIFICATION,
        data: { type: cloud ? "hatchai-chick-detected" : "hatchai-manual-test", url: cloud ? content.url : "https://hatchai-8d34c.web.app/" },
        webpush: {
          headers: { TTL: "300", Urgency: "normal" },
          notification: { tag: cloud ? content.tag : "hatchai-manual-test" },
          fcm_options: { link: cloud ? content.url : "https://hatchai-8d34c.web.app/" }
        }
      } })
    }, deadline);
    if (response.status === 401) session.access = null;
    if (cloud) {
      if (response.status === 404 && response.body?.error?.details?.some?.((item) => item.errorCode === "UNREGISTERED")) return { outcome: "invalid-token" };
      if (response.status === 429 || response.status === 503) return { outcome: "retryable" };
      if (!response.ok) return { outcome: "failed" };
      return { outcome: typeof response.body?.name === "string" && response.body.name.startsWith(`projects/${PROJECT}/messages/`) ? "accepted" : "unknown" };
    }
    need(
      response.ok && typeof response.body?.name === "string" && response.body.name.startsWith(`projects/${PROJECT}/messages/`),
      502,
      "FCM did not confirm the test. Check notification configuration and refresh this phone registration."
    );
    return { accepted: true, displayConfirmed: false };
  };
}
__name(prepareDelivery, "prepareDelivery");

// src/pairing.js
var ORIGIN = "https://hatchai-8d34c.web.app";
var DAY90 = 90 * 86400;
var browserPaths = /* @__PURE__ */ new Set(["/pairing/redeem", "/register", "/registration/challenge", "/registration/refresh", "/unregister", "/registration/test-notification"]);
var devicePaths = /* @__PURE__ */ new Set(["/device/pairing/challenge", "/device/pairing/start", "/device/pairing/status", "/device/pairing/cancel"]);
var now = /* @__PURE__ */ __name(() => Math.floor(Date.now() / 1e3), "now");
var stmt = /* @__PURE__ */ __name((env, sql, ...args) => env.DB.prepare(sql).bind(...args), "stmt");
var changes = /* @__PURE__ */ __name((r) => Number(r.meta?.changes), "changes");
function id(value) {
  need(typeof value === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(value));
  return value;
}
__name(id, "id");
function freshness(body) {
  id(body.requestId);
  need(Number.isSafeInteger(body.issuedAt) && Math.abs(now() - body.issuedAt) <= 60, 401, "Expired request");
}
__name(freshness, "freshness");
async function limit(env, binding, key) {
  need(env[binding]?.limit, 503, "Rate limiter unavailable");
  need((await env[binding].limit({ key })).success, 429, "Too many requests");
}
__name(limit, "limit");
function liveDevice(env, row) {
  deviceSecret(env, row.device_id, row.device_key_id);
  requireControllerRole(row.device_id);
}
__name(liveDevice, "liveDevice");
function tokenInput(body) {
  need(typeof body.token === "string" && /^[A-Za-z0-9_:.-]{20,4096}$/.test(body.token));
  need(body.deviceName === void 0 || typeof body.deviceName === "string" && body.deviceName.length <= 80 && !/[\x00-\x1f\x7f]/.test(body.deviceName));
}
__name(tokenInput, "tokenInput");
async function pairingChallenge(env, b) {
  freshness(b);
  need(["start", "status", "cancel"].includes(b.operation));
  const challenge = b.operation + ":" + random();
  await stmt(
    env,
    `INSERT INTO pairing_sessions
    (id,device_id,device_key_id,device_challenge,challenge_expires_at,created_at,updated_at)
    VALUES(?,?,?,?,unixepoch()+60,unixepoch(),unixepoch())`,
    b.requestId,
    b.deviceId,
    b.keyId,
    challenge
  ).run();
  return { sessionId: b.requestId, challenge, expiresIn: 60 };
}
__name(pairingChallenge, "pairingChallenge");
async function deviceOperation(env, path, b) {
  id(b.sessionId);
  const operation = path.split("/").at(-1);
  const c = await stmt(
    env,
    `SELECT * FROM pairing_sessions WHERE id=? AND device_id=? AND device_key_id=?`,
    b.sessionId,
    b.deviceId,
    b.keyId
  ).first();
  need(c && c.state === "challenge" && c.challenge_expires_at > now() && c.device_challenge === b.challenge && c.device_challenge.startsWith(operation + ":"), 401, "Invalid challenge");
  if (operation === "start") {
    const code = pairingCode(), hash = await protectedHash(env, "code", code);
    const results2 = await env.DB.batch([
      stmt(env, `UPDATE pairing_sessions SET state='expired',code_hash=NULL,grant_hash=NULL,updated_at=unixepoch()
        WHERE device_id=? AND ((state='issued' AND code_expires_at<=unixepoch()) OR
        (state='redeemed' AND grant_expires_at<=unixepoch()))`, b.deviceId),
      stmt(env, `UPDATE pairing_sessions SET state='issued',code_hash=?,code_issued_at=unixepoch(),
        code_expires_at=unixepoch()+300,updated_at=unixepoch()
        WHERE id=? AND state='challenge' AND challenge_expires_at>unixepoch() AND device_challenge=?`, hash, b.sessionId, b.challenge)
    ]);
    need(changes(results2[1]) === 1, 409, "Challenge already used");
    return { pairingId: b.sessionId, code, expiresIn: 300 };
  }
  id(b.pairingId);
  need(b.pairingId !== b.sessionId);
  const fence = random();
  const claim = stmt(env, `UPDATE pairing_sessions SET state='cancelled',registration_attempt_id=?,updated_at=unixepoch()
    WHERE id=? AND state='challenge' AND challenge_expires_at>unixepoch() AND device_challenge=?`, fence, b.sessionId, b.challenge);
  const gate = `EXISTS(SELECT 1 FROM pairing_sessions c WHERE c.id=? AND c.registration_attempt_id=?)`;
  const queries = [claim];
  if (operation === "cancel") queries.push(stmt(
    env,
    `UPDATE pairing_sessions SET state='cancelled',code_hash=NULL,
    grant_hash=NULL,updated_at=unixepoch() WHERE id=? AND device_id=? AND state IN ('issued','redeemed') AND ${gate}`,
    b.pairingId,
    b.deviceId,
    b.sessionId,
    fence
  ));
  queries.push(stmt(env, `SELECT state,code_expires_at,grant_expires_at FROM pairing_sessions
    WHERE id=? AND device_id=? AND ${gate}`, b.pairingId, b.deviceId, b.sessionId, fence));
  const results = await env.DB.batch(queries);
  need(changes(results[0]) === 1, 409, "Challenge already used");
  const row = results.at(-1).results[0];
  need(row, 404, "Pairing unavailable");
  const expired = row.state === "issued" && row.code_expires_at <= now() || row.state === "redeemed" && row.grant_expires_at <= now();
  return { pairingId: b.pairingId, state: expired ? "expired" : row.state };
}
__name(deviceOperation, "deviceOperation");
async function redeem(env, b) {
  need(typeof b.code === "string" && b.code.length <= 24);
  const code = b.code.toUpperCase().replaceAll("-", "");
  need(/^[A-Z2-7]{16}$/.test(code));
  const hash = await protectedHash(env, "code", code);
  const pair = await stmt(env, `SELECT * FROM pairing_sessions WHERE code_hash=? AND state='issued'`, hash).first();
  need(pair, 401, "Pairing unavailable");
  liveDevice(env, pair);
  const pub = await publicKey(b.publicKey);
  await verifyBrowser(b.publicKey, "/pairing/redeem", b);
  const grant = random(), grantHash = await protectedHash(env, "grant", grant);
  const row = await stmt(
    env,
    `UPDATE pairing_sessions SET state='redeemed',browser_public_key_jwk=?,grant_hash=?,
    grant_expires_at=unixepoch()+300,redeemed_at=unixepoch(),updated_at=unixepoch(),code_hash=NULL
    WHERE id=? AND code_hash=? AND state='issued' AND code_expires_at>unixepoch() RETURNING id`,
    pub.json,
    grantHash,
    pair.id,
    hash
  ).first();
  need(row, 401, "Pairing unavailable");
  return { pairingId: row.id, grant, expiresIn: 300 };
}
__name(redeem, "redeem");
async function register(env, b) {
  id(b.pairingId);
  id(b.grant);
  tokenInput(b);
  const pair = await stmt(env, `SELECT * FROM pairing_sessions WHERE id=?`, b.pairingId).first();
  need(pair?.browser_public_key_jwk, 401, "Unauthorized");
  liveDevice(env, pair);
  await verifyBrowser(JSON.parse(pair.browser_public_key_jwk), "/register", b);
  const grantHash = await protectedHash(env, "grant", b.grant);
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
  need(results.slice(0, 3).every((r) => changes(r) === 1) && results[3].results.length === 1, 409, "Authorization already used");
  return { registered: true, registrationId, authorizedUntil: results[3].results[0].authorized_until };
}
__name(register, "register");
async function manage(env, path, b) {
  need(Boolean(b.registrationId) !== Boolean(b.pairingId));
  if (b.pairingId) need(path === "/registration/challenge");
  const field = b.registrationId ? "registration_id" : "pairing_session_id";
  const lookup = id(b.registrationId || b.pairingId);
  const auth = await stmt(env, `SELECT * FROM push_registration_auth WHERE ${field}=?`, lookup).first();
  need(auth && auth.revoked_at === null && auth.authorized_until > now(), 401, "Unauthorized");
  liveDevice(env, auth);
  await verifyBrowser(JSON.parse(auth.browser_public_key_jwk), path, b);
  await limit(env, path === "/registration/test-notification" ? "TEST_NOTIFICATION_LIMITER" : "REGISTRATION_LIMITER", `owner:${path}:${auth.registration_id}`);
  if (path === "/registration/challenge") {
    freshness(b);
    await stmt(env, `UPDATE push_registration_auth SET request_nonce=?,nonce_expires_at=unixepoch()+60
      WHERE registration_id=? AND nonce_expires_at<=unixepoch() AND revoked_at IS NULL AND authorized_until>unixepoch()`, random(), auth.registration_id).run();
    const current = await stmt(env, `SELECT registration_id,request_nonce,nonce_expires_at,version,authorized_until
      FROM push_registration_auth WHERE registration_id=? AND revoked_at IS NULL AND authorized_until>unixepoch()`, auth.registration_id).first();
    need(current, 401, "Unauthorized");
    return {
      registrationId: current.registration_id,
      nonce: current.request_nonce,
      expiresAt: current.nonce_expires_at,
      version: current.version,
      authorizedUntil: current.authorized_until
    };
  }
  need(Number.isSafeInteger(b.version) && b.version >= 0);
  id(b.nonce);
  if (path === "/registration/test-notification") {
    need(Object.keys(b).every((key) => ["registrationId", "nonce", "version", "signature"].includes(key)));
    const send = await prepareTestDelivery(env);
    const fence = random();
    const results2 = await env.DB.batch([
      stmt(
        env,
        `UPDATE push_registration_auth SET request_nonce=?,nonce_expires_at=unixepoch()+60,
        version=version+1,updated_at=unixepoch() WHERE registration_id=? AND request_nonce=? AND version=?
        AND nonce_expires_at>unixepoch() AND revoked_at IS NULL AND authorized_until>unixepoch()
        AND EXISTS(SELECT 1 FROM push_tokens t WHERE t.id=registration_id AND t.enabled=1)`,
        fence,
        auth.registration_id,
        b.nonce,
        b.version
      ),
      stmt(env, `SELECT t.token FROM push_tokens t JOIN push_registration_auth a ON a.registration_id=t.id
        WHERE a.registration_id=? AND a.request_nonce=? AND a.version=? AND a.revoked_at IS NULL
        AND a.authorized_until>unixepoch() AND t.enabled=1`, auth.registration_id, fence, b.version + 1)
    ]);
    need(changes(results2[0]) === 1 && results2[1].results.length === 1, 409, "Expired or consumed authorization");
    return await send(results2[1].results[0].token);
  }
  if (path === "/registration/refresh") tokenInput(b);
  const nextNonce = random(), revoked = path === "/unregister";
  const gate = `EXISTS(SELECT 1 FROM push_registration_auth a WHERE a.registration_id=? AND a.request_nonce=? AND a.version=?)`;
  const results = await env.DB.batch([
    stmt(env, `UPDATE push_registration_auth SET request_nonce=?,nonce_expires_at=unixepoch()+60,version=version+1,
      revoked_at=CASE WHEN ? THEN unixepoch() ELSE NULL END,updated_at=unixepoch()
      WHERE registration_id=? AND request_nonce=? AND version=? AND nonce_expires_at>unixepoch()
      AND revoked_at IS NULL AND authorized_until>unixepoch()`, nextNonce, revoked ? 1 : 0, auth.registration_id, b.nonce, b.version),
    revoked ? stmt(
      env,
      `UPDATE push_tokens SET enabled=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND ${gate}`,
      auth.registration_id,
      auth.registration_id,
      nextNonce,
      b.version + 1
    ) : stmt(env, `UPDATE push_tokens SET token=?,device_name=COALESCE(?,device_name),updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND ${gate}`, b.token, b.deviceName ?? null, auth.registration_id, auth.registration_id, nextNonce, b.version + 1)
  ]);
  need(results.every((r) => changes(r) === 1), 409, "Expired or consumed authorization");
  return { success: true, registrationId: auth.registration_id, version: b.version + 1 };
}
__name(manage, "manage");
async function pairingFetch(request, env) {
  const url = new URL(request.url), path = url.pathname, origin = request.headers.get("Origin");
  const json = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, { status, headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
    ...origin === ORIGIN && browserPaths.has(path) ? {
      "Access-Control-Allow-Origin": ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600"
    } : {}
  } }), "json");
  try {
    need(browserPaths.has(path) || devicePaths.has(path), 404, "Endpoint not found");
    need(!url.search, 400, "URL parameters are not accepted");
    need(url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), 400, "HTTPS required");
    if (browserPaths.has(path)) need(origin === ORIGIN, 403, "Origin not allowed");
    else need(!origin, 403, "Device endpoint");
    if (request.method === "OPTIONS" && browserPaths.has(path)) return json({});
    need(request.method === "POST", 405, "POST required");
    const body = await readBody(request);
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    if (devicePaths.has(path)) {
      const operation = path.endsWith("/challenge") ? body.operation : path.split("/").at(-1);
      need(["start", "status", "cancel"].includes(operation));
      const binding2 = operation === "status" ? "DEVICE_STATUS_LIMITER" : operation === "cancel" ? "DEVICE_CANCEL_LIMITER" : "DEVICE_PAIRING_LIMITER";
      await limit(env, binding2, `ip:${ip}`);
      await verifyController(env, path, body);
      await limit(env, binding2, `device:${body.deviceId}`);
      return json(path.endsWith("/challenge") ? await pairingChallenge(env, body) : await deviceOperation(env, path, body));
    }
    const binding = path === "/pairing/redeem" ? "BROWSER_REDEEM_LIMITER" : path === "/register" ? "BROWSER_REGISTER_LIMITER" : path === "/registration/test-notification" ? "TEST_NOTIFICATION_LIMITER" : "REGISTRATION_LIMITER";
    await limit(env, binding, `ip:${path}:${ip}`);
    if (path === "/pairing/redeem") return json(await redeem(env, body));
    if (path === "/register") return json(await register(env, body));
    return json(await manage(env, path, body));
  } catch (error) {
    if (error instanceof ApiError) return json({ success: false, message: error.message }, error.status);
    if (/UNIQUE constraint failed/.test(String(error?.message))) return json({ success: false, message: "Registration or pairing conflict" }, 409);
    return json({ success: false, message: "Service unavailable" }, 503);
  }
}
__name(pairingFetch, "pairingFetch");

// src/retention.js
var CLEANUP_BATCH = 250;
var CLEANUP_ROUNDS = 4;
async function cleanup(env) {
  const totals = { expired: 0, deleted: 0, retiredNonces: 0 };
  for (let round = 0; round < CLEANUP_ROUNDS; round++) {
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE pairing_sessions SET state='expired',code_hash=NULL,
        grant_hash=NULL,updated_at=unixepoch() WHERE id IN (
          SELECT id FROM pairing_sessions WHERE
          (state='challenge' AND challenge_expires_at<=unixepoch()) OR
          (state='issued' AND code_expires_at<=unixepoch()) OR
          (state='redeemed' AND grant_expires_at<=unixepoch()) LIMIT 250)`),
      env.DB.prepare(`DELETE FROM pairing_sessions WHERE id IN (
        SELECT id FROM pairing_sessions WHERE
          (state IN ('expired','cancelled') AND updated_at<=unixepoch()-86400) OR
          (state='registered' AND registered_at<=unixepoch()-8380800 AND NOT EXISTS (
            SELECT 1 FROM push_registration_auth a WHERE a.pairing_session_id=pairing_sessions.id
            AND a.revoked_at IS NULL AND a.authorized_until>unixepoch()))
        LIMIT 250)`),
      env.DB.prepare(`UPDATE push_registration_auth SET
        request_nonce='retired:'||registration_id||':'||version,
        nonce_expires_at=0,version=version+1 WHERE registration_id IN (
          SELECT registration_id FROM push_registration_auth WHERE nonce_expires_at>0
          AND (nonce_expires_at<=unixepoch() OR authorized_until<=unixepoch() OR revoked_at IS NOT NULL)
          LIMIT 250)`)
    ]);
    const counts = results.map((r) => Number(r.meta?.changes || 0));
    totals.expired += counts[0];
    totals.deleted += counts[1];
    totals.retiredNonces += counts[2];
    if (counts.every((n) => n < CLEANUP_BATCH)) break;
  }
  return { ...totals, backlogPossible: Object.values(totals).some((n) => n >= CLEANUP_BATCH * CLEANUP_ROUNDS) };
}
__name(cleanup, "cleanup");

// src/supabase-session.js
var PROJECT2 = "https://dihufafcztqjuudjeqdm.supabase.co";
function supabaseSessionVerifier(env, fetcher = globalThis.fetch.bind(globalThis)) {
  return async (authorization) => {
    need(env.SUPABASE_URL === PROJECT2 && typeof env.SUPABASE_PUBLISHABLE_KEY === "string" && /^sb_publishable_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_PUBLISHABLE_KEY), 503, "User authentication unavailable");
    need(typeof authorization === "string" && /^Bearer [A-Za-z0-9._-]{32,8192}$/.test(authorization), 401, "Sign in required");
    try {
      const response = await fetcher(PROJECT2 + "/auth/v1/user", {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(8e3),
        headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization }
      });
      if (response.status === 401 || response.status === 403) throw new ApiError(401, "Sign in required");
      need(response.ok && response.status < 300, 503, "User authentication unavailable");
      const reader = response.body?.getReader();
      need(reader, 503, "User authentication unavailable");
      const chunks = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 16384) {
          await reader.cancel();
          throw new ApiError(503, "User authentication unavailable");
        }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const user = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      need(typeof user?.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) && user.role === "authenticated" && user.is_anonymous !== true, 401, "Sign in required");
      return Object.freeze({ id: user.id });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "User authentication unavailable");
    }
  };
}
__name(supabaseSessionVerifier, "supabaseSessionVerifier");

// src/online-api.js
async function onlineFetch(request, env, fetcher = globalThis.fetch.bind(globalThis)) {
  const origin = request.headers.get("Origin");
  const allowed = /* @__PURE__ */ new Set(["https://hatchai-8d34c.web.app"]);
  for (const value of (env.ONLINE_ALLOWED_ORIGINS || "").split(",")) {
    if (/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(value) || /^http:\/\/127\.0\.0\.1:\d+$/.test(value)) allowed.add(value);
  }
  const headers = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  const json = /* @__PURE__ */ __name((body, status = 200) => Response.json(body, { status, headers }), "json");
  try {
    need(!origin || allowed.has(origin), 403, "Origin not allowed");
    const url = new URL(request.url);
    need(!url.search, 400, "Query parameters are not supported");
    if (request.method === "OPTIONS") {
      need(request.headers.get("Access-Control-Request-Method") === "GET", 405, "Method not allowed");
      const requested = (request.headers.get("Access-Control-Request-Headers") || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
      need(requested.every((x) => x === "authorization"), 400, "Headers not allowed");
      return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Authorization" } });
    }
    need(request.method === "GET", 405, "Method not allowed");
    const authorization = request.headers.get("Authorization");
    const user = await supabaseSessionVerifier(env, fetcher)(authorization);
    const response = await fetcher(env.SUPABASE_URL + "/rest/v1/incubators?select=id,device_name,device_id,owner_id&owner_id=eq." + user.id + "&limit=20", {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(8e3),
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization }
    });
    need(response.ok, 503, "Incubator lookup unavailable");
    const reader = response.body?.getReader();
    need(reader, 503, "Incubator lookup unavailable");
    let size = 0;
    const chunks = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16384) {
        await reader.cancel();
        throw new ApiError(503, "Incubator lookup unavailable");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const rows = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    need(Array.isArray(rows) && rows.length <= 20 && rows.every((row) => row && row.owner_id === user.id && ["id", "device_name", "device_id"].every((key) => typeof row[key] === "string" && row[key].length <= 256)), 503, "Incubator lookup unavailable");
    return json({ incubators: rows.map(({ id: id2, device_name, device_id }) => ({ id: id2, device_name, device_id })), monitoringConnected: false });
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : "Online service unavailable" }, error instanceof ApiError ? error.status : 503);
  }
}
__name(onlineFetch, "onlineFetch");

// src/index.js
var index_default = {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanup(env).then((counts) => {
      if (counts.backlogPossible) console.warn("Pairing cleanup reached work bound", counts);
      else console.info("Pairing cleanup counts", counts);
    }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/online/incubators") return onlineFetch(request, env);
    const json = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, {
      status,
      headers: {
        "Cache-Control": "no-store"
      }
    }), "json");
    if (request.method === "GET" && url.pathname === "/") {
      return json({
        application: "HATCHAI",
        service: "Push Notification API",
        status: "online",
        firebaseProject: "hatchai-8d34c"
      });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      try {
        const result = await env.DB.prepare(
          "SELECT COUNT(*) AS total FROM push_tokens WHERE enabled = 1"
        ).first();
        return json({
          status: "ok",
          database: "connected",
          registeredDevices: result.total
        });
      } catch (error) {
        return json({
          status: "error",
          database: "unavailable"
        }, 503);
      }
    }
    if (request.method === "POST" && url.pathname === "/register") {
      return pairingFetch(request, env);
    }
    if (request.method === "POST" && url.pathname === "/chick-detected") {
      return json({
        success: false,
        message: "Authenticated detection delivery is pending."
      }, 503);
    }
    return pairingFetch(request, env);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
