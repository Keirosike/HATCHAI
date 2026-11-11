var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/security.js
function need(value, status = 400, message = "Invalid request") {
  if (!value) throw new ApiError(status, message);
}
function random(bytes = 32) {
  return b64(crypto.getRandomValues(new Uint8Array(bytes)));
}
function b64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function unb64(value) {
  need(typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value));
  try {
    return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
  } catch {
    throw new ApiError(400, "Invalid encoding");
  }
}
async function sha(value) {
  return b64(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}
async function hmacKey(secret) {
  const bytes = unb64(secret);
  need(bytes.length === 32, 503, "Security configuration unavailable");
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function protectedHash(env, purpose, value) {
  need(env.PAIRING_HASH_KEY, 503, "Security configuration unavailable");
  return b64(await crypto.subtle.sign(
    "HMAC",
    await hmacKey(env.PAIRING_HASH_KEY),
    encoder.encode(`${purpose}
${value}`)
  ));
}
async function signingMessage(path, body) {
  const unsigned = { ...body };
  delete unsigned.signature;
  return encoder.encode(`HATCHAI-NOTIFY-v1
POST
${path}
${await sha(canonical(unsigned))}`);
}
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
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
async function verifyDevice(env, path, body) {
  const key = await hmacKey(deviceSecret(env, body.deviceId, body.keyId));
  need(typeof body.signature === "string", 401, "Unauthorized");
  need(await crypto.subtle.verify("HMAC", key, unb64(body.signature), await signingMessage(path, body)), 401, "Unauthorized");
}
function requireControllerRole(deviceId) {
  need(
    Object.hasOwn(DEVICE_ROLES, deviceId) && DEVICE_ROLES[deviceId] === "controller",
    403,
    "Controller pairing only"
  );
}
async function verifyController(env, path, body) {
  await verifyDevice(env, path, body);
  requireControllerRole(body.deviceId);
}
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
function pairingCode() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => alphabet[n & 31]).join("");
}
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
var encoder, DEVICE_ROLES, ApiError;
var init_security = __esm({
  "src/security.js"() {
    encoder = new TextEncoder();
    DEVICE_ROLES = Object.freeze({
      "hatchai-inc01-controller": "controller",
      "hatchai-inc01-cam01": "camera",
      "hatchai-inc01-cam02": "camera"
    });
    ApiError = class extends Error {
      static {
        __name(this, "ApiError");
      }
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    };
    __name(need, "need");
    __name(random, "random");
    __name(b64, "b64");
    __name(unb64, "unb64");
    __name(sha, "sha");
    __name(hmacKey, "hmacKey");
    __name(protectedHash, "protectedHash");
    __name(signingMessage, "signingMessage");
    __name(canonical, "canonical");
    __name(deviceSecret, "deviceSecret");
    __name(verifyDevice, "verifyDevice");
    __name(requireControllerRole, "requireControllerRole");
    __name(verifyController, "verifyController");
    __name(publicKey, "publicKey");
    __name(verifyBrowser, "verifyBrowser");
    __name(pairingCode, "pairingCode");
    __name(readBody, "readBody");
  }
});

// src/supabase-session.js
function supabaseSessionVerifier(env, fetcher = globalThis.fetch.bind(globalThis)) {
  return async (authorization) => {
    need(env.SUPABASE_URL === PROJECT && typeof env.SUPABASE_PUBLISHABLE_KEY === "string" && /^sb_publishable_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_PUBLISHABLE_KEY), 503, "User authentication unavailable");
    need(typeof authorization === "string" && /^Bearer [A-Za-z0-9._-]{32,8192}$/.test(authorization), 401, "Sign in required");
    try {
      const response = await fetcher(PROJECT + "/auth/v1/user", {
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
var PROJECT;
var init_supabase_session = __esm({
  "src/supabase-session.js"() {
    init_security();
    PROJECT = "https://dihufafcztqjuudjeqdm.supabase.co";
    __name(supabaseSessionVerifier, "supabaseSessionVerifier");
  }
});

// node_modules/uint8array-extras/index.js
function isType(value, typeConstructor, typeStringified) {
  if (!value) {
    return false;
  }
  if (value.constructor === typeConstructor) {
    return true;
  }
  return objectToString.call(value) === typeStringified;
}
function isUint8Array(value) {
  return isType(value, Uint8Array, uint8ArrayStringified);
}
function isArrayBuffer(value) {
  return isType(value, ArrayBuffer, arrayBufferStringified);
}
function isUint8ArrayOrArrayBuffer(value) {
  return isUint8Array(value) || isArrayBuffer(value);
}
function toUint8ArrayIfArrayBuffer(value) {
  return isArrayBuffer(value) ? new Uint8Array(value) : value;
}
function assertUint8ArrayOrArrayBuffer(value) {
  if (!isUint8ArrayOrArrayBuffer(value)) {
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof value}\``);
  }
}
function toUint8Array(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`Unsupported value, got \`${typeof value}\`.`);
}
function concatUint8Arrays(arrays, totalLength) {
  if (arrays.length === 0) {
    return new Uint8Array(0);
  }
  totalLength ??= arrays.reduce((accumulator, currentValue) => accumulator + currentValue.byteLength, 0);
  const returnValue = new Uint8Array(totalLength);
  let offset = 0;
  for (let array of arrays) {
    assertUint8ArrayOrArrayBuffer(array);
    array = toUint8ArrayIfArrayBuffer(array);
    returnValue.set(array, offset);
    offset += array.length;
  }
  return returnValue;
}
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected \`string\`, got \`${typeof value}\``);
  }
}
function stringToUint8Array(string) {
  assertString(string);
  return cachedEncoder.encode(string);
}
function base64ToBase64Url(base64) {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function base64UrlToBase64(base64url) {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const padding = (4 - base64.length % 4) % 4;
  return base64 + "=".repeat(padding);
}
function uint8ArrayToBase64(array, { urlSafe = false } = {}) {
  assertUint8ArrayOrArrayBuffer(array);
  array = toUint8ArrayIfArrayBuffer(array);
  let base64 = "";
  for (let index = 0; index < array.length; index += MAX_BLOCK_SIZE) {
    const chunk = array.subarray(index, index + MAX_BLOCK_SIZE);
    base64 += globalThis.btoa(String.fromCodePoint.apply(void 0, chunk));
  }
  return urlSafe ? base64ToBase64Url(base64) : base64;
}
function base64ToUint8Array(base64String) {
  assertString(base64String);
  return Uint8Array.from(globalThis.atob(base64UrlToBase64(base64String)), (x) => x.codePointAt(0));
}
var objectToString, uint8ArrayStringified, arrayBufferStringified, cachedDecoders, cachedEncoder, MAX_BLOCK_SIZE, byteToHexLookupTable;
var init_uint8array_extras = __esm({
  "node_modules/uint8array-extras/index.js"() {
    objectToString = Object.prototype.toString;
    uint8ArrayStringified = "[object Uint8Array]";
    arrayBufferStringified = "[object ArrayBuffer]";
    __name(isType, "isType");
    __name(isUint8Array, "isUint8Array");
    __name(isArrayBuffer, "isArrayBuffer");
    __name(isUint8ArrayOrArrayBuffer, "isUint8ArrayOrArrayBuffer");
    __name(toUint8ArrayIfArrayBuffer, "toUint8ArrayIfArrayBuffer");
    __name(assertUint8ArrayOrArrayBuffer, "assertUint8ArrayOrArrayBuffer");
    __name(toUint8Array, "toUint8Array");
    __name(concatUint8Arrays, "concatUint8Arrays");
    cachedDecoders = {
      utf8: new globalThis.TextDecoder("utf8")
    };
    __name(assertString, "assertString");
    cachedEncoder = new globalThis.TextEncoder();
    __name(stringToUint8Array, "stringToUint8Array");
    __name(base64ToBase64Url, "base64ToBase64Url");
    __name(base64UrlToBase64, "base64UrlToBase64");
    MAX_BLOCK_SIZE = 65535;
    __name(uint8ArrayToBase64, "uint8ArrayToBase64");
    __name(base64ToUint8Array, "base64ToUint8Array");
    byteToHexLookupTable = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/utils.js
function encodeRecordSize(size) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, size);
  return bytes;
}
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
var init_utils = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/utils.js"() {
    __name(encodeRecordSize, "encodeRecordSize");
    __name(invariant, "invariant");
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/client-keys.js
async function deriveClientKeys(sub) {
  const bytes = base64ToUint8Array(sub.keys.p256dh);
  const authSecretBytes = base64ToUint8Array(sub.keys.auth);
  invariant(bytes.byteLength === 65 && bytes[0] === 4, "Subscription p256dh is not an uncompressed P-256 point");
  invariant(authSecretBytes.byteLength === 16, "Subscription auth secret is not 16 bytes");
  return {
    publicKeyBytes: bytes,
    publicKey: await crypto.subtle.importKey("raw", bytes, {
      name: "ECDH",
      namedCurve: "P-256"
    }, false, []),
    authSecretBytes
  };
}
var init_client_keys = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/client-keys.js"() {
    init_uint8array_extras();
    init_utils();
    __name(deriveClientKeys, "deriveClientKeys");
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/hkdf.js
function createHMAC(data) {
  const keyPromise = crypto.subtle.importKey("raw", data, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  return {
    hash: /* @__PURE__ */ __name(async (input) => {
      const k = await keyPromise;
      return crypto.subtle.sign("HMAC", k, input);
    }, "hash")
  };
}
async function hkdf(salt, ikm) {
  const prkhPromise = createHMAC(salt).hash(ikm).then((prk) => createHMAC(prk));
  return {
    extract: /* @__PURE__ */ __name(async (info, len) => {
      const prkh = await prkhPromise;
      const blocks = await Array.from({ length: Math.ceil(len / 32) }, (_, i) => i).reduce(async (acc, i) => {
        const previous = await acc;
        const hash = await prkh.hash(new Uint8Array([...previous.at(-1) ?? [], ...info, i + 1]));
        return [...previous, new Uint8Array(hash)];
      }, Promise.resolve([]));
      return concatUint8Arrays(blocks).slice(0, len);
    }, "extract")
  };
}
var init_hkdf = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/hkdf.js"() {
    init_uint8array_extras();
    __name(createHMAC, "createHMAC");
    __name(hkdf, "hkdf");
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/info.js
function createKeyInfo(clientPublic, serverPublic) {
  return new Uint8Array([
    ...stringToUint8Array("WebPush: info\0"),
    ...clientPublic,
    ...serverPublic
  ]);
}
function createInfo(type) {
  return stringToUint8Array(`Content-Encoding: ${type}\0`);
}
var init_info = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/info.js"() {
    init_uint8array_extras();
    __name(createKeyInfo, "createKeyInfo");
    __name(createInfo, "createInfo");
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/local-keys.js
async function generateLocalKeys() {
  const keyPair = await crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, false, ["deriveBits"]);
  return {
    privateKey: keyPair.privateKey,
    publicKeyBytes: new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
  };
}
var init_local_keys = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/local-keys.js"() {
    __name(generateLocalKeys, "generateLocalKeys");
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/salt.js
async function getSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}
var init_salt = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/salt.js"() {
    __name(getSalt, "getSalt");
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/encrypt.js
async function encryptNotification(subscription, plaintext, options = {}) {
  invariant(plaintext.byteLength <= maxPlaintextSize, `Payload is ${plaintext.byteLength} bytes, the maximum is ${maxPlaintextSize}`);
  const clientKeys = await deriveClientKeys(subscription);
  const salt = await getSalt();
  const localKeys = await generateLocalKeys();
  const sharedSecret = await crypto.subtle.deriveBits({
    name: "ECDH",
    public: clientKeys.publicKey
  }, localKeys.privateKey, 256);
  const keyInfo = createKeyInfo(clientKeys.publicKeyBytes, localKeys.publicKeyBytes);
  const cekInfo = createInfo("aes128gcm");
  const nonceInfo = createInfo("nonce");
  const ikmHkdf = await hkdf(clientKeys.authSecretBytes, sharedSecret);
  const ikm = await ikmHkdf.extract(keyInfo, 32);
  const messageHkdf = await hkdf(salt, ikm);
  const cekBytes = await messageHkdf.extract(cekInfo, 16);
  const nonceBytes = await messageHkdf.extract(nonceInfo, 12);
  const cekCryptoKey = await crypto.subtle.importKey("raw", cekBytes, {
    name: "AES-GCM",
    length: 128
  }, false, ["encrypt"]);
  const padTo = options.pad ?? true ? maxPlaintextSize : plaintext.byteLength;
  const padded = new Uint8Array(padTo + 1);
  padded.set(plaintext);
  padded[plaintext.byteLength] = 2;
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: nonceBytes
  }, cekCryptoKey, padded);
  return new Uint8Array([
    ...salt,
    ...encodeRecordSize(recordSize),
    localKeys.publicKeyBytes.byteLength,
    ...localKeys.publicKeyBytes,
    ...new Uint8Array(encrypted)
  ]);
}
var recordSize, headerSize, maxPlaintextSize;
var init_encrypt = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/encrypt.js"() {
    init_client_keys();
    init_hkdf();
    init_info();
    init_local_keys();
    init_salt();
    init_utils();
    recordSize = 4096;
    headerSize = 21 + 65;
    maxPlaintextSize = recordSize - headerSize - 17;
    __name(encryptNotification, "encryptNotification");
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/base64.js
function encodeBase64Url(value) {
  return uint8ArrayToBase64(toUint8Array(value), { urlSafe: true });
}
function objectToBase64Url(obj) {
  return encodeBase64Url(stringToUint8Array(JSON.stringify(obj)));
}
var init_base64 = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/base64.js"() {
    init_uint8array_extras();
    __name(encodeBase64Url, "encodeBase64Url");
    __name(objectToBase64Url, "objectToBase64Url");
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/jwt.js
async function sign(payload, key) {
  const headerStr = objectToBase64Url({
    typ: "JWT",
    alg: "ES256"
  });
  const payloadStr = objectToBase64Url({
    iat: Math.floor(Date.now() / 1e3),
    ...payload
  });
  const dataStr = `${headerStr}.${payloadStr}`;
  const signature = await crypto.subtle.sign({
    name: "ECDSA",
    hash: "SHA-256"
  }, key, stringToUint8Array(dataStr));
  return `${dataStr}.${encodeBase64Url(signature)}`;
}
var init_jwt = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/jwt.js"() {
    init_uint8array_extras();
    init_base64();
    __name(sign, "sign");
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/vapid.js
async function vapidHeaders(subscription, vapid) {
  invariant(vapid.subject, "Vapid subject is empty");
  invariant(vapid.privateKey, "Vapid private key is empty");
  invariant(vapid.publicKey, "Vapid public key is empty");
  const endpoint = new URL(subscription.endpoint);
  invariant(endpoint.protocol === "https:", `Subscription endpoint is not https: ${endpoint.protocol}`);
  const vapidPublicKeyBytes = base64ToUint8Array(vapid.publicKey);
  const publicKey2 = await crypto.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(vapidPublicKeyBytes.slice(1, 33)),
    y: encodeBase64Url(vapidPublicKeyBytes.slice(33, 65)),
    d: vapid.privateKey
  }, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, ["sign"]);
  const jwt = await sign({
    aud: endpoint.origin,
    exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60,
    sub: vapid.subject
  }, publicKey2);
  return {
    headers: {
      authorization: `vapid t=${jwt}, k=${vapid.publicKey}`
    }
  };
}
var init_vapid = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/vapid.js"() {
    init_uint8array_extras();
    init_base64();
    init_jwt();
    init_utils();
    __name(vapidHeaders, "vapidHeaders");
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/payload.js
async function buildPushPayload(message, subscription, vapid) {
  const { headers } = await vapidHeaders(subscription, vapid);
  const body = await encryptNotification(subscription, stringToUint8Array(
    // if its a primitive, convert to string, otherwise stringify
    typeof message.data === "string" || typeof message.data === "number" ? message.data.toString() : JSON.stringify(message.data)
  ));
  return {
    headers: {
      ...headers,
      ttl: (message.options?.ttl || 60).toString(),
      ...message.options?.urgency && {
        urgency: message.options.urgency
      },
      ...message.options?.topic && {
        topic: message.options.topic
      },
      "content-encoding": "aes128gcm",
      "content-length": body.byteLength.toString(),
      "content-type": "application/octet-stream"
    },
    method: "post",
    body
  };
}
var init_payload = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/payload.js"() {
    init_uint8array_extras();
    init_encrypt();
    init_vapid();
    __name(buildPushPayload, "buildPushPayload");
  }
});

// node_modules/@block65/webcrypto-web-push/dist/lib/main.js
var init_main = __esm({
  "node_modules/@block65/webcrypto-web-push/dist/lib/main.js"() {
    init_encrypt();
    init_vapid();
    init_payload();
  }
});

// src/cloud-notifications.js
function validateDetection(body, now2) {
  need(exact(body, ["cameraId", "position", "batchId", "eventId", "detectedAt", "type"]));
  need(id(body.cameraId) && id(body.batchId) && typeof body.eventId === "string" && /^[A-Za-z0-9_-]{20,96}$/.test(body.eventId));
  need(body.position === "upper" || body.position === "lower");
  need(body.type === "chick_detected" && Number.isSafeInteger(body.detectedAt) && body.detectedAt > now2 - 86400 && body.detectedAt <= now2 + 60);
  need(new TextEncoder().encode(JSON.stringify(body)).length <= 1024, 413);
  return Object.freeze({ ...body });
}
var id, exact;
var init_cloud_notifications = __esm({
  "src/cloud-notifications.js"() {
    init_security();
    id = /* @__PURE__ */ __name((value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value), "id");
    exact = /* @__PURE__ */ __name((body, fields) => body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === fields.length && fields.every((key) => Object.hasOwn(body, key)), "exact");
    __name(validateDetection, "validateDetection");
  }
});

// src/native-push-retry.js
function retryAfterMs(value, nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  const fallback = 3e4;
  if (value == null) return fallback;
  const text = value.trim();
  if (text.length > 128) return null;
  if (/^\d+$/.test(text)) {
    if (text.length > 32) return null;
    const delay = BigInt(text) * 1000n;
    if (delay > BigInt(Number.MAX_SAFE_INTEGER - nowMs)) return null;
    return Math.max(1e3, Number(delay));
  }
  let canonical2 = text;
  const obsolete = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(text);
  if (obsolete) {
    const yearNow = new Date(nowMs).getUTCFullYear();
    let year = Math.floor(yearNow / 100) * 100 + Number(obsolete[4]);
    if (year > yearNow + 50) year -= 100;
    canonical2 = `${obsolete[1].slice(0, 3)}, ${obsolete[2]} ${obsolete[3]} ${String(year).padStart(4, "0")} ${obsolete[5]} GMT`;
  }
  const asctime = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( \d|\d{2}) (\d{2}:\d{2}:\d{2}) (\d{4})$/.exec(text);
  if (asctime) canonical2 = `${asctime[1]}, ${asctime[3].trim().padStart(2, "0")} ${asctime[2]} ${asctime[5]} ${asctime[4]} GMT`;
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(canonical2)) {
    const date = Date.parse(canonical2);
    if (Number.isSafeInteger(date) && new Date(date).toUTCString() === canonical2) return Math.max(1e3, date - nowMs);
  }
  return fallback;
}
function retryDeadline(result, item, nowMs) {
  if (result.outcome !== "retryable" || !Number.isInteger(item.attempt) || item.attempt < 1 || item.attempt >= 3 || !Number.isSafeInteger(nowMs) || nowMs < 0 || !Number.isSafeInteger(item.expiresAt)) return null;
  const delay = result.retryAfterMs ?? 3e4;
  if (!Number.isSafeInteger(delay) || delay < 0 || !Number.isSafeInteger(nowMs + delay)) return null;
  const provider = result.retryNotBefore ?? nowMs + delay;
  if (!Number.isSafeInteger(provider) || provider < 0) return null;
  const backoff = nowMs + 15e3 * 2 ** (item.attempt - 1);
  const deadline = Math.max(backoff, provider);
  return Number.isSafeInteger(deadline) && deadline < item.expiresAt ? deadline : null;
}
var init_native_push_retry = __esm({
  "src/native-push-retry.js"() {
    __name(retryAfterMs, "retryAfterMs");
    __name(retryDeadline, "retryDeadline");
  }
});

// src/native-push-delivery.js
var native_push_delivery_exports = {};
__export(native_push_delivery_exports, {
  chickPayload: () => chickPayload,
  nativeDispatch: () => nativeDispatch,
  sendNativePush: () => sendNativePush,
  sendNativeTest: () => sendNativeTest
});
function chickPayload(event) {
  need(event && ["upper", "lower"].includes(event.position) && /^[A-Za-z0-9_-]{16,96}$/.test(event.eventId));
  need(event.batchName === void 0 || typeof event.batchName === "string" && event.batchName.length <= 80 && !/[\x00-\x1f\x7f<>]/.test(event.batchName));
  return { type: "hatchai-chick-detected", position: event.position, eventId: event.eventId, ...event.batchName ? { batchName: event.batchName } : {} };
}
async function sendNativePush(env, subscription, message, fetcher = globalThis.fetch.bind(globalThis), now2 = () => Date.now()) {
  if (env.NATIVE_PUSH_DELIVERY_ENABLED !== "true") return { outcome: "disabled" };
  return sendEncrypted(env, subscription, chickPayload(message), fetcher, now2);
}
async function sendNativeTest(env, subscription, eventId, fetcher = globalThis.fetch.bind(globalThis), now2 = () => Date.now()) {
  if (env.NATIVE_PUSH_TEST_ENABLED !== "true") return { outcome: "disabled" };
  need(typeof eventId === "string" && /^[A-Za-z0-9_-]{16,96}$/.test(eventId));
  return sendEncrypted(env, subscription, { type: "hatchai-native-test", eventId }, fetcher, now2);
}
async function sendEncrypted(env, subscription, payload, fetcher, now2) {
  if (!env.NATIVE_PUSH_VAPID_PRIVATE_KEY || !env.NATIVE_PUSH_VAPID_PUBLIC_KEY || !env.NATIVE_PUSH_VAPID_SUBJECT) return { outcome: "unconfigured" };
  let sub;
  try {
    sub = await validateSubscription(subscription);
    pushEndpoint(sub.endpoint);
  } catch {
    throw new ApiError(503, "test_stored_subscription_invalid");
  }
  try {
    decodeKey(env.NATIVE_PUSH_VAPID_PRIVATE_KEY, 32);
  } catch {
    throw new ApiError(503, "test_private_key_format");
  }
  try {
    decodeKey(env.NATIVE_PUSH_VAPID_PUBLIC_KEY, 65);
  } catch {
    throw new ApiError(503, "test_public_key_format");
  }
  need(/^mailto:[^\s@]+@[^\s@]+$/.test(env.NATIVE_PUSH_VAPID_SUBJECT) || /^https:\/\/[a-z0-9.-]+\/?$/.test(env.NATIVE_PUSH_VAPID_SUBJECT), 503, "test_subject_format");
  const raw = decodeKey(env.NATIVE_PUSH_VAPID_PUBLIC_KEY, 65);
  const b642 = /* @__PURE__ */ __name((value) => btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""), "b64");
  const jwk = { kty: "EC", crv: "P-256", x: b642(raw.slice(1, 33)), y: b642(raw.slice(33)), d: env.NATIVE_PUSH_VAPID_PRIVATE_KEY };
  try {
    const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const publicKey2 = await crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const probe = new TextEncoder().encode("HATCHAI VAPID configuration check");
    need(await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey2,
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, probe),
      probe
    ), 503, "Push configuration unavailable");
  } catch {
    throw new ApiError(503, "test_vapid_pair_invalid");
  }
  let request;
  try {
    request = await buildPushPayload(
      { data: payload, options: { ttl: 300, urgency: "normal" } },
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      { publicKey: env.NATIVE_PUSH_VAPID_PUBLIC_KEY, privateKey: env.NATIVE_PUSH_VAPID_PRIVATE_KEY, subject: env.NATIVE_PUSH_VAPID_SUBJECT }
    );
  } catch {
    throw new ApiError(503, "test_payload_encryption_failed");
  }
  let response;
  try {
    response = await fetcher(sub.endpoint, { ...request, redirect: "manual", signal: AbortSignal.timeout(8e3) });
  } catch {
    return { outcome: "unknown" };
  }
  const status = response.status;
  await response.body?.cancel();
  if (status === 201 || status === 202) return { outcome: "accepted", displayConfirmed: false };
  if (status === 404 || status === 410) return { outcome: "expired" };
  if (status === 429 || status >= 500) {
    const receivedAt = now2(), delay = retryAfterMs(response.headers.get("Retry-After"), receivedAt);
    if (delay === null) return { outcome: "failed" };
    return { outcome: "retryable", retryAfterMs: delay, retryNotBefore: receivedAt + delay };
  }
  return { outcome: "failed", providerStatus: status };
}
function nativeDispatch({ authorize, repository, send, now: now2 = /* @__PURE__ */ __name(() => Date.now(), "now") }) {
  return {
    async accept(envelope) {
      need(envelope && uuid(envelope.incubatorId) && new TextEncoder().encode(JSON.stringify(envelope)).length <= 4096);
      const detection = validateDetection(envelope.event, Math.floor(now2() / 1e3));
      const source = await authorize(envelope);
      const event = chickPayload({ ...detection, batchName: source?.batchName });
      need(source?.enabled === true && source.incubatorId === envelope.incubatorId && source.position === event.position && source.cameraId === envelope.cameraId && source.cameraId === detection.cameraId && source.batchId === detection.batchId, 403, "Event access denied");
      const accepted = await repository.accept({ source, event: { ...detection, ...event }, now: now2() });
      need(accepted && ["accepted", "duplicate"].includes(accepted.status), 409, "Event not accepted");
      return { accepted: true, duplicate: accepted.status === "duplicate" };
    },
    async deliverOne() {
      const item = await repository.claim(now2());
      if (!item) return { processed: false };
      need(item.leaseId && Number.isInteger(item.attempt) && item.attempt >= 1 && item.attempt <= 3 && item.expiresAt > now2(), 503, "Invalid delivery claim");
      let result;
      try {
        result = await send(item.subscription, item.event);
      } catch {
        result = { outcome: "unknown" };
      }
      const allowed = ["accepted", "expired", "retryable", "unknown", "failed", "disabled", "unconfigured"];
      if (!allowed.includes(result?.outcome)) result = { outcome: "unknown" };
      const retryAt = retryDeadline(result, item, now2());
      need(await repository.finish(item.leaseId, { outcome: result.outcome, retryAt, disableSubscription: result.outcome === "expired" }), 503, "Delivery result unconfirmed");
      return { processed: true, outcome: result.outcome, displayConfirmed: false };
    }
  };
}
var init_native_push_delivery = __esm({
  "src/native-push-delivery.js"() {
    init_main();
    init_native_push();
    init_cloud_notifications();
    init_security();
    init_native_push_retry();
    __name(chickPayload, "chickPayload");
    __name(sendNativePush, "sendNativePush");
    __name(sendNativeTest, "sendNativeTest");
    __name(sendEncrypted, "sendEncrypted");
    __name(nativeDispatch, "nativeDispatch");
  }
});

// src/native-push.js
function pushEndpoint(value) {
  need(typeof value === "string" && value.length >= 32 && value.length <= 2048 && !/[\s\x00-\x1f\x7f]/.test(value));
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "Invalid push endpoint");
  }
  const provider = url.hostname === "fcm.googleapis.com" && url.pathname.startsWith("/fcm/send/") || url.hostname === "updates.push.services.mozilla.com" && url.pathname.startsWith("/wpush/v2/") || url.hostname === "web.push.apple.com" && url.pathname.startsWith("/");
  need(provider && url.protocol === "https:" && !url.port && !url.username && !url.password && !url.hash && !url.search && url.href === value, 400, "Unsupported push endpoint");
  return value;
}
function decodeKey(value, bytes) {
  need(typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) && value.length === Math.ceil(bytes * 4 / 3));
  let raw;
  try {
    raw = Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch {
    throw new ApiError(400, "Invalid push key");
  }
  need(raw.length === bytes && btoa(String.fromCharCode(...raw)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_") === value);
  return raw;
}
async function validateSubscription(value) {
  need(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((k) => ["endpoint", "keys", "expirationTime"].includes(k)));
  const endpoint = pushEndpoint(value.endpoint);
  need(value.expirationTime == null || Number.isSafeInteger(value.expirationTime) && value.expirationTime > Date.now());
  need(value.keys && Object.keys(value.keys).length === 2);
  const raw = decodeKey(value.keys.p256dh, 65);
  decodeKey(value.keys.auth, 16);
  need(raw[0] === 4);
  try {
    await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch {
    throw new ApiError(400, "Invalid push key");
  }
  return { endpoint, p256dh: value.keys.p256dh, auth: value.keys.auth };
}
async function boundedJson(response, maximum = 16384) {
  const reader = response.body?.getReader();
  need(reader, 503, "Push storage unavailable");
  const parts = [];
  let length = 0;
  for (; ; ) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > maximum) {
      await reader.cancel();
      throw new ApiError(503, "Push storage unavailable");
    }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ApiError(503, "Invalid service response");
  }
}
function pushRepository(env, fetcher) {
  return async (operation, args) => {
    need(/^sb_secret_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_BACKEND_KEY || ""), 503, "Push storage unavailable");
    const response = await fetcher(env.SUPABASE_URL + "/rest/v1/rpc/hatchai_push_" + operation, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(8e3),
      headers: { apikey: env.SUPABASE_BACKEND_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(args)
    });
    if (response.status === 409) throw new ApiError(409, "Subscription belongs to another account");
    if (response.status === 403) throw new ApiError(403, "Incubator access denied");
    need(response.ok, 503, "Push storage unavailable");
    return boundedJson(response);
  };
}
async function nativePushFetch(request, env, fetcher = globalThis.fetch.bind(globalThis)) {
  const origin = request.headers.get("Origin");
  const origins = new Set((env.ONLINE_ALLOWED_ORIGINS || "").split(",").filter((x) => /^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(x) || /^http:\/\/127\.0\.0\.1:\d+$/.test(x)));
  const headers = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  const json = /* @__PURE__ */ __name((data, status = 200) => Response.json(data, { status, headers }), "json");
  try {
    need(!origin || origins.has(origin), 403, "Origin not allowed");
    const url = new URL(request.url), operation = url.pathname.split("/").pop();
    const method = ["public-key", "status"].includes(operation) ? "GET" : "POST";
    need(["public-key", "status", "subscribe", "unsubscribe", "test"].includes(operation), 404, "Not found");
    if (request.method === "OPTIONS") {
      need(request.headers.get("Access-Control-Request-Method") === method, 405, "Method not allowed");
      need((request.headers.get("Access-Control-Request-Headers") || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).every((x) => ["authorization", "content-type"].includes(x)), 400, "Headers not allowed");
      return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": method, "Access-Control-Allow-Headers": "Authorization, Content-Type" } });
    }
    need(request.method === method, 405, "Method not allowed");
    need(env.NATIVE_PUSH_LIMITER?.limit, 503, "Push rate limiter unavailable");
    need((await env.NATIVE_PUSH_LIMITER.limit({ key: "ip:" + (request.headers.get("CF-Connecting-IP") || "local") })).success, 429, "Please retry later");
    const user = await supabaseSessionVerifier(env, fetcher)(request.headers.get("Authorization"));
    need((await env.NATIVE_PUSH_LIMITER.limit({ key: user.id })).success, 429, "Please retry later");
    if (operation === "public-key") {
      need(!url.search, 400);
      need(typeof env.NATIVE_PUSH_VAPID_PUBLIC_KEY === "string", 503, "Push configuration unavailable");
      const raw = decodeKey(env.NATIVE_PUSH_VAPID_PUBLIC_KEY, 65);
      need(raw[0] === 4, 503, "Push configuration unavailable");
      try {
        await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
      } catch {
        throw new ApiError(503, "Push configuration unavailable");
      }
      return json({ publicKey: env.NATIVE_PUSH_VAPID_PUBLIC_KEY });
    }
    let body;
    if (method === "GET") {
      need([...url.searchParams.keys()].length === 1 && url.searchParams.has("incubatorId"), 400);
      body = { incubatorId: url.searchParams.get("incubatorId") };
    } else {
      need(!url.search && (request.headers.get("Content-Type") || "").split(";")[0] === "application/json", 400);
      try {
        body = await boundedJson(request, 4096);
      } catch {
        throw new ApiError(400, "Invalid subscription request");
      }
    }
    const fields = operation === "subscribe" ? ["incubatorId", "subscription", "deviceLabel"] : operation === "unsubscribe" ? ["incubatorId", "endpoint"] : operation === "test" ? ["incubatorId", "endpointHash"] : ["incubatorId"];
    need(body && Object.keys(body).length === fields.length && fields.every((k) => Object.hasOwn(body, k)) && uuid(body.incubatorId));
    const owned = await fetcher(env.SUPABASE_URL + "/rest/v1/incubators?select=id,owner_id&id=eq." + body.incubatorId + "&owner_id=eq." + user.id + "&limit=1", {
      redirect: "manual",
      signal: AbortSignal.timeout(8e3),
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: request.headers.get("Authorization") }
    });
    need(owned.ok, 503, "Incubator lookup unavailable");
    const rows = await boundedJson(owned);
    need(Array.isArray(rows) && rows.length === 1 && rows[0].id === body.incubatorId && rows[0].owner_id === user.id, 403, "Incubator access denied");
    const args = { p_user: user.id, p_incubator: body.incubatorId };
    if (operation === "test") {
      need(env.NATIVE_PUSH_TEST_ENABLED === "true", 503, "Controlled testing disabled");
      need(env.TEST_NOTIFICATION_LIMITER?.limit && (await env.TEST_NOTIFICATION_LIMITER.limit({ key: "native-test:" + user.id })).success, 429, "Please retry later");
      need(typeof body.endpointHash === "string" && /^[0-9a-f]{64}$/.test(body.endpointHash));
      let record;
      try {
        record = await pushRepository(env, fetcher)("test_subscription", { ...args, p_endpoint_hash: body.endpointHash });
      } catch {
        return json({ code: "test_subscription_lookup_failed" }, 503);
      }
      need(record?.confirmed === true && record.subscription, 503, "Subscription unavailable");
      const { sendNativeTest: sendNativeTest2 } = await Promise.resolve().then(() => (init_native_push_delivery(), native_push_delivery_exports));
      let outcome;
      const testId = crypto.randomUUID();
      try {
        outcome = await sendNativeTest2(env, { endpoint: record.subscription.endpoint, keys: { p256dh: record.subscription.p256dh, auth: record.subscription.auth } }, testId, fetcher);
      } catch (error) {
        const allowed = ["test_stored_subscription_invalid", "test_private_key_format", "test_public_key_format", "test_subject_format", "test_vapid_pair_invalid", "test_payload_encryption_failed"];
        return json({ code: error instanceof ApiError && allowed.includes(error.message) ? error.message : "test_configuration_or_encryption_failed" }, 503);
      }
      if (outcome.outcome === "expired") await pushRepository(env, fetcher)("expire", { ...args, p_endpoint: record.subscription.endpoint, p_p256dh: record.subscription.p256dh, p_auth: record.subscription.auth });
      if (outcome.outcome !== "accepted") return json({
        accepted: false,
        displayConfirmed: false,
        code: "test_" + outcome.outcome,
        ...Number.isInteger(outcome.providerStatus) ? { providerStatus: outcome.providerStatus } : {}
      }, 503);
      return json({ accepted: true, displayConfirmed: false, testId });
    }
    if (operation === "subscribe") {
      need(typeof body.deviceLabel === "string" && body.deviceLabel.length <= 80 && !/[\x00-\x1f\x7f<>]/.test(body.deviceLabel));
      const sub = await validateSubscription(body.subscription);
      Object.assign(args, { p_endpoint: sub.endpoint, p_p256dh: sub.p256dh, p_auth: sub.auth, p_label: body.deviceLabel });
    } else if (operation === "unsubscribe") args.p_endpoint = pushEndpoint(body.endpoint);
    const result = await pushRepository(env, fetcher)(operation, args);
    need(result && result.confirmed === true, 503, "Push storage not confirmed");
    if (operation === "status") need(Array.isArray(result.subscriptions) && result.subscriptions.length <= 20 && result.subscriptions.every((x) => /^[0-9a-f]{64}$/.test(x.endpointHash) && typeof x.enabled === "boolean"), 503);
    return json(operation === "status" ? { subscriptions: result.subscriptions.map((x) => ({ endpointHash: x.endpointHash, enabled: x.enabled })) } : { registered: operation === "subscribe" });
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : "Push service unavailable" }, error instanceof ApiError ? error.status : 503);
  }
}
var uuid;
var init_native_push = __esm({
  "src/native-push.js"() {
    init_security();
    init_supabase_session();
    uuid = /* @__PURE__ */ __name((value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value), "uuid");
    __name(pushEndpoint, "pushEndpoint");
    __name(decodeKey, "decodeKey");
    __name(validateSubscription, "validateSubscription");
    __name(boundedJson, "boundedJson");
    __name(pushRepository, "pushRepository");
    __name(nativePushFetch, "nativePushFetch");
  }
});

// src/camera-captures.js
init_security();
init_native_push();
init_supabase_session();
var MAX_CAPTURE_BYTES = 131072;
async function captureBytes(input, maximum = MAX_CAPTURE_BYTES, signal = AbortSignal.timeout(8e3)) {
  const reader = input.body?.getReader();
  need(reader, 400, "Image body required");
  let listener;
  const aborted = new Promise((_, reject) => {
    listener = /* @__PURE__ */ __name(() => reject(new ApiError(408, "Image deadline exceeded")), "listener");
    signal.addEventListener("abort", listener, { once: true });
    if (signal.aborted) listener();
  });
  const parts = [];
  let length = 0;
  try {
    for (; ; ) {
      const p = await Promise.race([reader.read(), aborted]);
      if (p.done) break;
      length += p.value.length;
      need(length <= maximum, 413, "Image too large");
      parts.push(p.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {
    });
    throw error;
  } finally {
    signal.removeEventListener("abort", listener);
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
__name(captureBytes, "captureBytes");
var imageHash = /* @__PURE__ */ __name(async (bytes) => b64(await crypto.subtle.digest("SHA-256", bytes)), "imageHash");
function jpeg(bytes) {
  need(bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217, 400, "JPEG required");
  let at = 2;
  while (at + 4 <= bytes.length) {
    need(bytes[at++] === 255, 400, "Invalid JPEG");
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    need(marker !== 0 && marker !== 216 && marker !== 217 && marker !== 218, 400, "JPEG dimensions required");
    const length = bytes[at] * 256 + bytes[at + 1];
    need(length >= 2 && at + length <= bytes.length, 400, "Invalid JPEG");
    if ([192, 193, 194].includes(marker)) {
      need(length >= 8, 400, "Invalid JPEG");
      const h = bytes[at + 3] * 256 + bytes[at + 4], w = bytes[at + 5] * 256 + bytes[at + 6];
      need(w > 0 && h > 0 && w <= 1280 && h <= 960, 400, "Image dimensions too large");
      return;
    }
    at += length;
  }
  throw new ApiError(400, "JPEG dimensions required");
}
__name(jpeg, "jpeg");
function configuration(env) {
  need(env.SUPABASE_URL === "https://dihufafcztqjuudjeqdm.supabase.co" && /^sb_secret_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_BACKEND_KEY || "") && /^[a-z0-9][a-z0-9-]{0,62}$/.test(env.CAMERA_CAPTURE_BUCKET || ""), 503, "Capture storage unavailable");
}
__name(configuration, "configuration");
var objectKey = /* @__PURE__ */ __name((value) => {
  need(typeof value === "string" && /^[0-9a-f-]{36}\/hatchai-inc01-cam0[12]\/[0-9a-f-]{36}\.jpg$/.test(value), 503, "Invalid storage record");
  return value;
}, "objectKey");
function captureServices(env, fetcher = fetch, signal = AbortSignal.timeout(15e3)) {
  configuration(env);
  const base = env.SUPABASE_URL, headers = { apikey: env.SUPABASE_BACKEND_KEY };
  const rpc = /* @__PURE__ */ __name(async (op, args = {}) => {
    const response = await fetcher(base + "/rest/v1/rpc/hatchai_capture_" + op, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(args), redirect: "manual", signal });
    need(response.ok, response.status === 403 ? 403 : response.status === 409 ? 409 : 503, "Capture storage unavailable");
    return boundedJson(response, 16384);
  }, "rpc");
  const bucket = env.CAMERA_CAPTURE_BUCKET;
  const privateBucket = /* @__PURE__ */ __name(async () => {
    const r = await fetcher(base + "/storage/v1/bucket/" + bucket, { headers, redirect: "manual", signal });
    need(r.ok, 503, "Private capture bucket unavailable");
    const info = await boundedJson(r, 4096);
    need(info.id === bucket && info.public === false, 503, "Private capture bucket required");
  }, "privateBucket");
  const get = /* @__PURE__ */ __name(async (key) => {
    const r = await fetcher(base + "/storage/v1/object/authenticated/" + bucket + "/" + objectKey(key), { headers, redirect: "manual", signal });
    need(r.ok, 503, "Capture unavailable");
    return captureBytes(r, MAX_CAPTURE_BYTES, signal);
  }, "get");
  const put = /* @__PURE__ */ __name(async (key, bytes) => {
    const r = await fetcher(base + "/storage/v1/object/" + bucket + "/" + objectKey(key), { method: "POST", headers: { ...headers, "Content-Type": "image/jpeg", "x-upsert": "false" }, body: bytes, redirect: "manual", signal });
    need(r.ok || r.status === 400 || r.status === 409, 503, "Capture upload unavailable");
    await r.body?.cancel();
    return get(key);
  }, "put");
  const remove = /* @__PURE__ */ __name(async (key) => {
    const r = await fetcher(base + "/storage/v1/object/" + bucket, { method: "DELETE", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: [objectKey(key)] }), redirect: "manual", signal });
    need(r.ok || r.status === 404, 503, "Capture cleanup unavailable");
    await r.body?.cancel();
    const check = await fetcher(base + "/storage/v1/object/authenticated/" + bucket + "/" + objectKey(key), { headers, redirect: "manual", signal });
    await check.body?.cancel();
    need(check.status === 404, 503, "Capture deletion not confirmed");
  }, "remove");
  return { rpc, privateBucket, get, put, remove };
}
__name(captureServices, "captureServices");
async function cameraCapturesFetch(request, env, dependencies = {}) {
  const origin = request.headers.get("Origin"), allowed = (env.ONLINE_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  const headers = { "Cache-Control": "no-store", Vary: "Origin", "X-Content-Type-Options": "nosniff" };
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  const json = /* @__PURE__ */ __name((value, status = 200) => Response.json(value, { status, headers }), "json");
  try {
    need(!origin || allowed.includes(origin), 403, "Origin not allowed");
    need(env.CAMERA_CAPTURES_ENABLED === "true" && env.CAMERA_CAPTURE_STORAGE_REVIEWED === "true", 503, "Camera captures are not enabled");
    const url = new URL(request.url), device = url.pathname === "/device/camera-captures", match = url.pathname.match(/^\/online\/incubators\/([0-9a-f-]{36})\/captures(?:\/([0-9a-f-]{36}))?$/i);
    need(!url.search && (device || match), 404, "Not found");
    if (request.method === "OPTIONS") {
      need(!device && request.headers.get("Access-Control-Request-Method") === "GET", 405, "GET required");
      need((request.headers.get("Access-Control-Request-Headers") || "").toLowerCase().split(",").filter((s) => s.trim()).every((s) => s.trim() === "authorization"), 400, "Headers not allowed");
      return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Authorization" } });
    }
    need(env.CAMERA_CAPTURE_LIMITER?.limit, 503, "Capture service unavailable");
    const rate = /* @__PURE__ */ __name(async (key) => need((await env.CAMERA_CAPTURE_LIMITER.limit({ key })).success, 429, "Rate limited"), "rate");
    const services = dependencies.services ?? captureServices(env, dependencies.fetcher ?? fetch);
    if (device) {
      need(request.method === "POST" && !origin, 405, "Device POST required");
      await rate("ip:" + request.headers.get("CF-Connecting-IP"));
      const envelope = request.headers.get("X-Hatchai-Capture");
      need(envelope && envelope.length <= 2048, 400, "Signed capture header required");
      let body;
      try {
        body = JSON.parse(envelope);
      } catch {
        throw new ApiError(400, "Invalid capture header");
      }
      const keys = ["deviceId", "keyId", "issuedAt", "nonce", "eventId", "contentHash", "byteLength", "signature"];
      need(body && typeof body === "object" && Object.keys(body).length === keys.length && keys.every((k) => Object.hasOwn(body, k)), 400, "Invalid capture header");
      const now2 = dependencies.now?.() ?? Math.floor(Date.now() / 1e3);
      need(Number.isSafeInteger(body.issuedAt) && Math.abs(now2 - body.issuedAt) <= 60 && typeof body.nonce === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(body.nonce), 401, "Unauthorized capture");
      need(["hatchai-inc01-cam01", "hatchai-inc01-cam02"].includes(body.deviceId), 403, "Camera only");
      need(uuid(body.eventId) && /^[A-Za-z0-9_-]{43}$/.test(body.contentHash) && Number.isInteger(body.byteLength) && body.byteLength >= 4 && body.byteLength <= MAX_CAPTURE_BYTES, 400, "Invalid capture");
      need(request.headers.get("Content-Type") === "image/jpeg" && !request.headers.has("Content-Encoding"), 415, "JPEG required");
      await verifyDevice({ NOTIFICATION_DEVICE_KEYS: env.CAMERA_EVENT_KEYS }, "/device/camera-captures", body);
      await rate("device:" + body.deviceId);
      const bytes2 = await captureBytes(request);
      need(bytes2.length === body.byteLength && await imageHash(bytes2) === body.contentHash, 400, "Image integrity failed");
      jpeg(bytes2);
      await services.privateBucket();
      const reservation = await services.rpc("reserve", { p_device: body.deviceId, p_key: body.keyId, p_event: body.eventId, p_nonce: await sha(body.nonce), p_hash: body.contentHash, p_bytes: bytes2.length });
      need(uuid(reservation?.id), 503, "Invalid capture reservation");
      objectKey(reservation.objectKey);
      if (!reservation.ready) {
        const stored = await services.put(reservation.objectKey, bytes2);
        need(stored.length === bytes2.length && await imageHash(stored) === body.contentHash, 503, "Stored image verification failed");
        need(await services.rpc("complete", { p_device: body.deviceId, p_key: body.keyId, p_id: reservation.id, p_hash: body.contentHash }) === true, 503, "Capture not confirmed");
      }
      return json({ accepted: true, eventId: body.eventId, captureId: reservation.id });
    }
    need(request.method === "GET" && uuid(match[1]) && (!match[2] || uuid(match[2])), 405, "GET required");
    const user = await supabaseSessionVerifier(env, dependencies.fetcher ?? fetch)(request.headers.get("Authorization"));
    await rate("user:" + user.id);
    const result = await services.rpc("read", { p_user: user.id, p_incubator: match[1], p_id: match[2] ?? null });
    if (!match[2]) {
      need(Array.isArray(result?.captures) && result.captures.length <= 50, 503, "Invalid capture list");
      return json({ captures: result.captures.map(({ id: id3, position, capturedAt, chick }) => ({ id: id3, position, capturedAt, chick })) });
    }
    need(result, 404, "Capture not found");
    await services.privateBucket();
    const bytes = await services.get(objectKey(result.objectKey));
    need(bytes.length === result.bytes && await imageHash(bytes) === result.hash, 503, "Image integrity failed");
    jpeg(bytes);
    return new Response(bytes, { headers: { ...headers, "Content-Type": "image/jpeg", "Content-Security-Policy": "default-src 'none'; sandbox", "Content-Disposition": "inline" } });
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : "Capture service unavailable" }, error instanceof ApiError ? error.status : 503);
  }
}
__name(cameraCapturesFetch, "cameraCapturesFetch");
async function cleanupCaptures(env, dependencies = {}) {
  if (env.CAMERA_CAPTURES_ENABLED !== "true" || env.CAMERA_CAPTURE_STORAGE_REVIEWED !== "true") return;
  const services = dependencies.services ?? captureServices(env, dependencies.fetcher ?? fetch);
  await services.privateBucket();
  const job = await services.rpc("cleanup_claim");
  if (!job) return;
  need(uuid(job.lease), 503, "Invalid cleanup lease");
  await services.remove(objectKey(job.objectKey));
  need(await services.rpc("cleanup_finish", { p_lease: job.lease }) === true, 503, "Cleanup not confirmed");
}
__name(cleanupCaptures, "cleanupCaptures");

// src/camera-events.js
init_security();
init_supabase_session();
init_native_push();
init_native_push_delivery();
function cameraRepository(env, fetcher = fetch) {
  return async (operation, args = {}) => {
    need(env.SUPABASE_URL === "https://dihufafcztqjuudjeqdm.supabase.co" && /^sb_secret_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_BACKEND_KEY || ""), 503, "Camera storage unavailable");
    const response = await fetcher(env.SUPABASE_URL + "/rest/v1/rpc/hatchai_camera_" + operation, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(8e3), headers: { apikey: env.SUPABASE_BACKEND_KEY, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    if (response.status === 403) throw new ApiError(403, "Camera access denied");
    if (response.status === 409) throw new ApiError(409, "Camera event conflict");
    need(response.ok, 503, "Camera storage unavailable");
    return boundedJson(response, 32768);
  };
}
__name(cameraRepository, "cameraRepository");
async function cameraEventsFetch(request, env, dependencies = {}) {
  const origin = request.headers.get("Origin"), allowed = new Set((env.ONLINE_ALLOWED_ORIGINS || "").split(","));
  const headers = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  const json = /* @__PURE__ */ __name((body, status = 200) => Response.json(body, { status, headers }), "json");
  try {
    need(!origin || allowed.has(origin), 403, "Origin not allowed");
    need(env.CAMERA_EVENTS_ENABLED === "true", 503, "Camera events are not enabled");
    const url = new URL(request.url), device = url.pathname === "/device/camera-events", match = url.pathname.match(/^\/online\/incubators\/([0-9a-f-]{36})\/camera-events$/i);
    need(!url.search && (device || match), 404, "Not found");
    if (request.method === "OPTIONS") {
      need(!device && request.headers.get("Access-Control-Request-Method") === "GET", 405, "Method not allowed");
      need((request.headers.get("Access-Control-Request-Headers") || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).every((x) => x === "authorization"), 400, "Headers not allowed");
      return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Authorization" } });
    }
    need(env.CAMERA_EVENT_LIMITER, 503, "Camera service unavailable");
    const repository = dependencies.repository ?? cameraRepository(env, dependencies.fetcher ?? fetch), now2 = dependencies.now?.() ?? Math.floor(Date.now() / 1e3);
    if (device) {
      need(request.method === "POST" && !origin, 405, "Device POST required");
      const body = await readBody(request);
      const keys = ["deviceId", "keyId", "issuedAt", "nonce", "eventId", "detectedAt", "signature"];
      need(Object.keys(body).length === keys.length && keys.every((k) => Object.hasOwn(body, k)), 400, "Invalid event");
      need(Number.isSafeInteger(body.issuedAt) && Math.abs(now2 - body.issuedAt) <= 60 && typeof body.nonce === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(body.nonce), 401, "Unauthorized camera");
      need(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.eventId) && Number.isSafeInteger(body.detectedAt) && body.detectedAt <= now2 + 60 && body.detectedAt >= now2 - 604800, 400, "Invalid event");
      need((await env.CAMERA_EVENT_LIMITER.limit({ key: "ip:" + request.headers.get("CF-Connecting-IP") })).success, 429, "Rate limited");
      await verifyDevice({ NOTIFICATION_DEVICE_KEYS: env.CAMERA_EVENT_KEYS }, "/device/camera-events", body);
      need((await env.CAMERA_EVENT_LIMITER.limit({ key: "camera:" + body.deviceId })).success, 429, "Rate limited");
      const result2 = await repository("accept", { p_device: body.deviceId, p_key: body.keyId, p_event: body.eventId, p_nonce: await sha(body.nonce), p_hash: await sha(canonical({ eventId: body.eventId, detectedAt: body.detectedAt })), p_detected: new Date(body.detectedAt * 1e3).toISOString() });
      need(result2?.accepted === true && result2.eventId === body.eventId, 503, "Camera storage unavailable");
      return json({ accepted: true, eventId: body.eventId, duplicate: result2.duplicate === true });
    }
    need(request.method === "GET", 405, "GET required");
    const user = await supabaseSessionVerifier(env, dependencies.fetcher ?? fetch)(request.headers.get("Authorization"));
    need((await env.CAMERA_EVENT_LIMITER.limit({ key: "user:" + user.id })).success, 429, "Rate limited");
    const result = await repository("read", { p_user: user.id, p_incubator: match[1] });
    need(result && Array.isArray(result.captures) && result.captures.length <= 50, 503, "Camera storage unavailable");
    return json({ captures: result.captures.map(({ position, capturedAt, chick }) => ({ position, capturedAt, chick })) });
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : "Camera service unavailable" }, error instanceof ApiError ? error.status : 503);
  }
}
__name(cameraEventsFetch, "cameraEventsFetch");
async function dispatchCamera(env, dependencies = {}) {
  if (env.CAMERA_EVENTS_ENABLED !== "true" || env.NATIVE_PUSH_DELIVERY_ENABLED !== "true") return { processed: false };
  const repository = dependencies.repository ?? cameraRepository(env, dependencies.fetcher ?? fetch), send = dependencies.send ?? ((subscription, event) => sendNativePush(env, subscription, event));
  const job = await repository("claim");
  if (!job) return { processed: false };
  need(typeof job.leaseId === "string" && Number.isInteger(job.attempt) && job.attempt >= 1 && job.attempt <= 3, 503, "Invalid delivery claim");
  let result;
  try {
    result = await send(job.subscription, job.event);
  } catch {
    result = { outcome: "unknown" };
  }
  const now2 = Date.now();
  let retry = null;
  if (result?.outcome === "retryable") {
    const delay = typeof result.retryAfterMs === "number" ? result.retryAfterMs : 3e4;
    retry = new Date(now2 + Math.max(1e3, delay)).toISOString();
  }
  const allowed = ["accepted", "expired", "failed", "unknown", "retryable", "disabled", "unconfigured"];
  const outcome = allowed.includes(result?.outcome) ? result.outcome : "unknown";
  const keys = job.subscription?.keys ?? {};
  need(await repository("finish", { p_lease: job.leaseId, p_outcome: outcome, p_retry: retry, p_endpoint: job.subscription?.endpoint ?? null, p_p256dh: keys.p256dh ?? null, p_auth: keys.auth ?? null }) === true, 503, "Delivery result unconfirmed");
  return { processed: true, outcome };
}
__name(dispatchCamera, "dispatchCamera");

// src/pairing.js
init_security();

// src/test-notification.js
init_security();
var TEST_NOTIFICATION = Object.freeze({
  title: "HATCHAI Test Notification",
  body: "Your HATCHAI notification system is working."
});
var PROJECT2 = "hatchai-8d34c";
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
      need(account.type === "service_account" && account.project_id === PROJECT2 && typeof account.client_email === "string" && /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(account.client_email) && (!account.token_uri || account.token_uri === OAUTH) && typeof account.private_key === "string");
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
    const response = await googleJson(`https://fcm.googleapis.com/v1/projects/${PROJECT2}/messages:send`, {
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
      return { outcome: typeof response.body?.name === "string" && response.body.name.startsWith(`projects/${PROJECT2}/messages/`) ? "accepted" : "unknown" };
    }
    need(
      response.ok && typeof response.body?.name === "string" && response.body.name.startsWith(`projects/${PROJECT2}/messages/`),
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
function id2(value) {
  need(typeof value === "string" && /^[A-Za-z0-9_-]{20,64}$/.test(value));
  return value;
}
__name(id2, "id");
function freshness(body) {
  id2(body.requestId);
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
  id2(b.sessionId);
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
  id2(b.pairingId);
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
  id2(b.pairingId);
  id2(b.grant);
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
  const lookup = id2(b.registrationId || b.pairingId);
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
  id2(b.nonce);
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

// src/online-api.js
init_supabase_session();
init_security();
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
      // Workers supports manual/follow. Inspect and reject redirects ourselves;
      // never forward the user's bearer token to a redirect destination.
      method: "GET",
      redirect: "manual",
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
    return json({ incubators: rows.map(({ id: id3, device_name, device_id }) => ({ id: id3, device_name, device_id })), monitoringConnected: false });
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : "Online service unavailable" }, error instanceof ApiError ? error.status : 503);
  }
}
__name(onlineFetch, "onlineFetch");

// src/telemetry.js
init_security();
init_supabase_session();
var uuid2 = /* @__PURE__ */ __name((x) => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x), "uuid");
var exact2 = /* @__PURE__ */ __name((v, keys) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k)), "exact");
function validateTelemetry(value, now2) {
  need(exact2(value, ["eventId", "capturedAt", "temperatureCenti", "humidityCenti", "sensorValid", "sensorAgeMs", "heaterOn", "fanOn", "lowerOn", "upperOn", "autoMode", "upperCameraOnline", "lowerCameraOnline", "upperChick", "lowerChick"]), 400, "Invalid telemetry");
  need(uuid2(value.eventId) && Number.isSafeInteger(value.capturedAt) && value.capturedAt <= now2 + 60 && value.capturedAt >= now2 - 604800, 400, "Invalid capture time");
  for (const k of ["sensorValid", "heaterOn", "lowerOn", "upperOn", "autoMode"]) need(typeof value[k] === "boolean", 400, "Invalid telemetry");
  need(value.fanOn === null, 400, "Fan feedback unavailable");
  if (value.sensorValid) {
    need(Number.isInteger(value.temperatureCenti) && value.temperatureCenti >= -4e3 && value.temperatureCenti <= 8e3 && Number.isInteger(value.humidityCenti) && value.humidityCenti >= 0 && value.humidityCenti <= 1e4 && Number.isInteger(value.sensorAgeMs) && value.sensorAgeMs >= 0 && value.sensorAgeMs < 2e4, 400, "Invalid sensor sample");
  } else need(value.temperatureCenti === null && value.humidityCenti === null && value.sensorAgeMs === null, 400, "Invalid sensor sample");
  for (const position of ["upper", "lower"]) {
    const online = value[position + "CameraOnline"], chick = value[position + "Chick"];
    need(online === null || typeof online === "boolean", 400, "Invalid camera status");
    need(online === true ? typeof chick === "boolean" : chick === null, 400, "Invalid detection status");
  }
  return { ...value };
}
__name(validateTelemetry, "validateTelemetry");
async function jsonBody(response, max = 65536) {
  const reader = response.body?.getReader();
  need(reader, 503, "Synchronization unavailable");
  let size = 0;
  const parts = [];
  for (; ; ) {
    const p = await reader.read();
    if (p.done) break;
    size += p.value.length;
    if (size > max) {
      await reader.cancel();
      throw new ApiError(503, "Synchronization unavailable");
    }
    parts.push(p.value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const p of parts) {
    data.set(p, offset);
    offset += p.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new ApiError(503, "Synchronization unavailable");
  }
}
__name(jsonBody, "jsonBody");
function telemetryRepository(env, fetcher = fetch) {
  return async (operation, args) => {
    need(env.SUPABASE_URL === "https://dihufafcztqjuudjeqdm.supabase.co" && /^sb_secret_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_BACKEND_KEY || ""), 503, "Synchronization unavailable");
    const r = await fetcher(env.SUPABASE_URL + "/rest/v1/rpc/hatchai_sync_" + operation, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(8e3), headers: { apikey: env.SUPABASE_BACKEND_KEY, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    if (r.status === 403) throw new ApiError(403, "Incubator access denied");
    if (r.status === 409) throw new ApiError(409, "Synchronization conflict");
    need(r.ok, 503, "Synchronization unavailable");
    return jsonBody(r);
  };
}
__name(telemetryRepository, "telemetryRepository");
async function telemetryFetch(request, env, dependencies = {}) {
  const now2 = dependencies.now?.() ?? Math.floor(Date.now() / 1e3), fetcher = dependencies.fetcher ?? fetch, repository = dependencies.repository ?? telemetryRepository(env, fetcher);
  const origins = new Set((env.ONLINE_ALLOWED_ORIGINS || "").split(",")), origin = request.headers.get("Origin");
  const headers = { "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && origins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  const json = /* @__PURE__ */ __name((value, status = 200) => Response.json(value, { status, headers }), "json");
  try {
    need(!origin || origins.has(origin), 403, "Origin not allowed");
    need(env.TELEMETRY_ENABLED === "true", 503, "Synchronization is not enabled");
    const url = new URL(request.url), device = url.pathname === "/device/telemetry", match = url.pathname.match(/^\/online\/incubators\/([0-9a-f-]{36})\/telemetry$/i);
    need(!url.search && (device || match), 404, "Not found");
    if (request.method === "OPTIONS") {
      need(!device && request.headers.get("Access-Control-Request-Method") === "GET", 405, "Method not allowed");
      need((request.headers.get("Access-Control-Request-Headers") || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).every((x) => x === "authorization"), 400, "Headers not allowed");
      return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Authorization" } });
    }
    const limiter = env.TELEMETRY_RATE_LIMITER;
    need(limiter && typeof limiter.limit === "function", 503, "Synchronization unavailable");
    if (device) {
      need(request.method === "POST" && !origin, 405, "Device POST required");
      const body = await readBody(request);
      need(exact2(body, ["deviceId", "keyId", "issuedAt", "nonce", "sample", "signature"]) && Number.isSafeInteger(body.issuedAt) && Math.abs(now2 - body.issuedAt) <= 60 && typeof body.nonce === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(body.nonce), 401, "Unauthorized device");
      need((await limiter.limit({ key: "device:" + request.headers.get("CF-Connecting-IP") })).success, 429, "Rate limited");
      await verifyDevice({ NOTIFICATION_DEVICE_KEYS: env.TELEMETRY_DEVICE_KEYS }, "/device/telemetry", body);
      need((await limiter.limit({ key: "telemetry:" + body.deviceId })).success, 429, "Rate limited");
      const sample = validateTelemetry(body.sample, now2);
      const result2 = await repository("ingest", { p_device: body.deviceId, p_key: body.keyId, p_event: sample.eventId, p_nonce: await sha(body.nonce), p_hash: await sha(canonical(sample)), p_captured: new Date(sample.capturedAt * 1e3).toISOString(), p_payload: sample });
      need(result2?.accepted === true && result2.eventId === sample.eventId, 503, "Synchronization unavailable");
      return json({ accepted: true, eventId: sample.eventId, duplicate: result2.duplicate === true });
    }
    need(request.method === "GET" && uuid2(match[1]), 405, "GET required");
    const user = await supabaseSessionVerifier(env, fetcher)(request.headers.get("Authorization"));
    need((await limiter.limit({ key: "read:" + user.id })).success, 429, "Rate limited");
    const result = await repository("read", { p_user: user.id, p_incubator: match[1] });
    need(result && Array.isArray(result.history) && result.history.length <= 96 && [true, false].includes(result.online), 503, "Synchronization unavailable");
    return json(result);
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : "Synchronization unavailable" }, error instanceof ApiError ? error.status : 503);
  }
}
__name(telemetryFetch, "telemetryFetch");

// src/index.js
init_native_push();
var index_default = {
  async scheduled(_event, env, ctx) {
    if (env.CAMERA_CAPTURES_ENABLED === "true") ctx.waitUntil(cleanupCaptures(env));
    if (env.CAMERA_EVENTS_ENABLED === "true") ctx.waitUntil(cameraRepository(env)("cleanup").then(() => dispatchCamera(env)));
    if (env.TELEMETRY_ENABLED === "true") ctx.waitUntil(telemetryRepository(env)("cleanup", {}));
    ctx.waitUntil(cleanup(env).then((counts) => {
      if (counts.backlogPossible) console.warn("Pairing cleanup reached work bound", counts);
      else console.info("Pairing cleanup counts", counts);
    }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/device/camera-captures" || /^\/online\/incubators\/[^/]+\/captures(?:\/[^/]+)?$/.test(url.pathname)) return cameraCapturesFetch(request, env);
    if (url.pathname === "/device/camera-events" || /^\/online\/incubators\/[^/]+\/camera-events$/.test(url.pathname)) return cameraEventsFetch(request, env);
    if (url.pathname === "/device/telemetry" || /^\/online\/incubators\/[^/]+\/telemetry$/.test(url.pathname)) return telemetryFetch(request, env);
    if (url.pathname.startsWith("/online/push/")) return nativePushFetch(request, env);
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
