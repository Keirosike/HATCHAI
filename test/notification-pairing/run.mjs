import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { canonical, sha, b64, hmacKey, signingMessage, verifyController } from '../../cloudflare-worker/src/security.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const local = fileURLToPath(new URL('./', import.meta.url));
const zig = process.env.HATCHAI_ZIG || path.join(local, '.tools/ziglang/zig.exe');
assert.ok(existsSync(zig), 'Set HATCHAI_ZIG or install the documented pinned local test compiler');
mkdirSync(path.join(local, '.build'), { recursive: true });
const executable = path.join(local, '.build/pairing-tests.exe');
function run(command, args, options = {}) {
  const r = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 600000,
    env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: path.join(local, '.build/zig-cache') }, ...options });
  if (r.status !== 0) throw Error(`${path.basename(command)} failed (${r.status}):\n${r.stdout || ''}\n${r.stderr || r.error || ''}`);
  return r.stdout;
}
run(zig, ['c++', '-std=c++11', '-O1', '-Wall', '-Wextra', '-DHATCHAI_PAIRING_TEST',
  '-Iinclude', '-I.pio/libdeps/esp32dev/ArduinoJson/src', 'src/NotificationPairingProtocol.cpp',
  'src/NotificationPairingClient.cpp', 'src/NotificationCredentialStore.cpp',
  'src/NotificationTransportResult.cpp', 'src/NotificationUtcClock.cpp',
  'src/NotificationHttpParser.cpp', 'src/NotificationBackgroundTransport.cpp',
  'src/NotificationTaskOwnership.cpp',
  'test/notification-pairing/native.cpp', '-lbcrypt', '-o', executable]);
process.stdout.write(run(executable, []));
const fixtures = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const requests = fixtures.map(v => ({ ...v, payload: typeof v.payload === 'string' ? v.payload : JSON.stringify(v.payload) }));
const actual = JSON.parse(run(executable, ['--vectors'], { input: JSON.stringify(requests) }));
assert.equal(actual.length, fixtures.length);
const keyBytes = Uint8Array.from({ length: 32 }, (_, i) => i); // Public deterministic test material only.
const encodedKey = b64(keyBytes);
const env = { NOTIFICATION_DEVICE_KEYS: JSON.stringify({ 'hatchai-inc01-controller': { 'test-key-v1': encodedKey } }) };
let verified = 0;
for (let i = 0; i < requests.length; i++) {
  const request = requests[i], result = actual[i];
  assert.equal(result.ok, !request.reject, `vector ${request.name}`);
  if (request.reject) { assert.equal(result.signature, undefined); continue; }
  const payload = JSON.parse(request.payload);
  if (request.action === 'canonical') assert.equal(result.canonical, canonical(payload), request.name);
  else {
    const unsigned = { ...payload }; delete unsigned.signature;
    assert.equal(result.canonical, canonical(unsigned), request.name);
    assert.equal(result.payloadHash, await sha(result.canonical), request.name);
    const expected = b64(await crypto.subtle.sign('HMAC', await hmacKey(encodedKey), await signingMessage(request.path, payload)));
    assert.equal(result.signature, expected, request.name);
    const body = JSON.parse(result.body);
    await verifyController(env, request.path, body);
    body.requestId = 'tampered-abcdefghijklmnopqrstuv';
    await assert.rejects(() => verifyController(env, request.path, body));
    verified++;
  }
}
console.log(`Cross-language vectors: ${fixtures.length} passed; ${verified} native signatures accepted by the actual Worker verifier; tampered requests rejected`);
