const encoder = new TextEncoder();
// Trusted board roles, never taken from request JSON or credential-map presence.
// Additional incubators require an explicitly reviewed registry update.
const DEVICE_ROLES = Object.freeze({
  'hatchai-inc01-controller': 'controller',
  'hatchai-inc01-cam01': 'camera',
  'hatchai-inc01-cam02': 'camera'
});
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function need(value, status = 400, message = 'Invalid request') {
  if (!value) throw new ApiError(status, message);
}
export function random(bytes = 32) {
  return b64(crypto.getRandomValues(new Uint8Array(bytes)));
}
export function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function unb64(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value));
  try { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
  catch { throw new ApiError(400, 'Invalid encoding'); }
}
export async function sha(value) { return b64(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
export async function hmacKey(secret) {
  const bytes = unb64(secret);
  need(bytes.length === 32, 503, 'Security configuration unavailable');
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function protectedHash(env, purpose, value) {
  need(env.PAIRING_HASH_KEY, 503, 'Security configuration unavailable');
  return b64(await crypto.subtle.sign('HMAC', await hmacKey(env.PAIRING_HASH_KEY),
    encoder.encode(`${purpose}\n${value}`)));
}
// Fixed tuple: no JSON canonicalization ambiguity; all fields are signed.
export async function signingMessage(path, body) {
  const unsigned = { ...body }; delete unsigned.signature;
  return encoder.encode(`HATCHAI-NOTIFY-v1\nPOST\n${path}\n${await sha(canonical(unsigned))}`);
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function deviceSecret(env, deviceId, keyId) {
  need(typeof deviceId === 'string' && /^[\w-]{1,64}$/.test(deviceId));
  need(typeof keyId === 'string' && /^[\w-]{1,64}$/.test(keyId));
  let devices;
  try { devices = JSON.parse(env.NOTIFICATION_DEVICE_KEYS || '{}'); }
  catch { throw new ApiError(503, 'Security configuration unavailable'); }
  const entry = Object.hasOwn(devices, deviceId) ? devices[deviceId] : null;
  const key = entry && Object.hasOwn(entry, keyId) ? entry[keyId] : null;
  need(typeof key === 'string', 401, 'Unauthorized');
  return key;
}
export async function verifyDevice(env, path, body) {
  const key = await hmacKey(deviceSecret(env, body.deviceId, body.keyId));
  need(typeof body.signature === 'string', 401, 'Unauthorized');
  need(await crypto.subtle.verify('HMAC', key, unb64(body.signature), await signingMessage(path, body)), 401, 'Unauthorized');
}
export function requireControllerRole(deviceId) {
  need(Object.hasOwn(DEVICE_ROLES, deviceId) && DEVICE_ROLES[deviceId] === 'controller',
    403, 'Controller pairing only');
}
export async function verifyController(env, path, body) {
  await verifyDevice(env, path, body);
  requireControllerRole(body.deviceId);
}
export async function publicKey(jwk) {
  need(jwk && jwk.kty === 'EC' && jwk.crv === 'P-256' && !jwk.d &&
    typeof jwk.x === 'string' && typeof jwk.y === 'string');
  need(unb64(jwk.x).length === 32 && unb64(jwk.y).length === 32);
  const clean = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  try {
    const key = await crypto.subtle.importKey('jwk', clean, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return { key, json: canonical(clean) };
  } catch { throw new ApiError(400, 'Invalid browser key'); }
}
export async function verifyBrowser(jwk, path, body) {
  const imported = await publicKey(jwk);
  need(typeof body.signature === 'string', 401, 'Unauthorized');
  const signature = unb64(body.signature);
  need(signature.length === 64 && await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' },
    imported.key, signature, await signingMessage(path, body)), 401, 'Unauthorized');
}
export function pairingCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  // Five low bits are uniform because 32 divides 256.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), n => alphabet[n & 31]).join('');
}
export async function readBody(request) {
  need(request.headers.get('Content-Type')?.split(';')[0].trim() === 'application/json', 415, 'JSON required');
  const reader = request.body?.getReader(); need(reader);
  const chunks = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.length;
    if (length > 8192) { await reader.cancel(); throw new ApiError(413, 'Request too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, 'Invalid JSON'); }
  need(body && typeof body === 'object' && !Array.isArray(body));
  return body;
}
