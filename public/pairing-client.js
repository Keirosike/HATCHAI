// Browser signing keys stay non-extractable in IndexedDB. No Firebase user account.
export const WORKER = 'https://hatchai.kurtzidrickguno-robles.workers.dev';
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const encode = value => new TextEncoder().encode(value);
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export class IndexedPairingStore {
  async transaction(mode, work) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('hatchai-notification-ownership', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('owner');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Secure browser storage unavailable.'));
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('owner', mode);const request = work(tx.objectStore('owner'));let value;
        request.onsuccess = () => { value = request.result; };
        tx.oncomplete = () => resolve(value);
        tx.onerror = tx.onabort = () => reject(new Error('Unable to save browser ownership.'));
      });
    } finally { db.close(); }
  }
  get() { return this.transaction('readonly', store => store.get('current')); }
  put(value) { return this.transaction('readwrite', store => store.put(value, 'current')); }
  clear() { return this.transaction('readwrite', store => store.delete('current')); }
}
export class PairingClient {
  constructor({ store = new IndexedPairingStore(), fetcher = globalThis.fetch.bind(globalThis), cryptoApi = globalThis.crypto } = {}) {
    this.store = store;this.fetcher = fetcher;this.crypto = cryptoApi;this.grant = null;this.cooldownUntil = 0;
  }
  async record(create = false) {
    let owner = await this.store.get();
    if (!owner && create) {
      const pair = await this.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      owner = { privateKey: pair.privateKey, publicKey: await this.crypto.subtle.exportKey('jwk', pair.publicKey) };
      await this.store.put(owner);
    }
    if (!owner?.privateKey || owner.privateKey.extractable || !owner.publicKey) throw new Error('Browser ownership key unavailable. Pair again using the LCD; existing registrations cannot be taken over.');
    return owner;
  }
  async post(path, body, owner) {
    if (Date.now() < this.cooldownUntil) throw new Error('Please wait before retrying this request.');
    const hash = b64(await this.crypto.subtle.digest('SHA-256', encode(canonical(body))));
    const signature = b64(await this.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, owner.privateKey,
      encode(`HATCHAI-NOTIFY-v1\nPOST\n${path}\n${hash}`)));
    const controller = new AbortController();const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await this.fetcher(WORKER + path, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, signature }), signal: controller.signal, redirect: 'error' });
      if (!response.ok) {
        if (response.status === 429) {
          const raw = response.headers.get('Retry-After');const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
          const delay = Number.isFinite(seconds) ? seconds * 1000 : raw ? Date.parse(raw) - Date.now() : 60000;
          this.cooldownUntil = Date.now() + Math.max(1000, Number.isFinite(delay) ? delay : 60000);
        }
        throw new Error(response.status === 429 ? 'Too many attempts. Wait before retrying.' :
          response.status === 409 ? 'Registration conflict. Existing browser ownership was preserved.' :
          response.status === 401 || response.status === 403 ? 'Pairing or browser authorization is unavailable or expired.' :
          path === '/registration/test-notification' ? 'Test notification unavailable or unconfirmed. Check this phone before retrying.' : 'Notification server unavailable. No registration success has been confirmed.');
      }
      const reader = response.body?.getReader();if (!reader) throw new Error('Invalid notification server response.');
      const chunks = [];let length = 0;
      while (true) { const part = await reader.read();if (part.done) break;length += part.value.length;
        if (length > 8192) { await reader.cancel();throw new Error('Invalid notification server response.'); }chunks.push(part.value); }
      const bytes = new Uint8Array(length);let offset = 0;for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.length; }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new Error('Invalid notification server response.'); }
    } finally { clearTimeout(timeout); }
  }
  async redeem(code) {
    code = code.trim().toUpperCase().replaceAll('-', '');if (!/^[A-Z2-7]{16}$/.test(code)) throw new Error('Enter the 16-character code shown on the physical LCD.');
    const owner = await this.record(true);
    const result = await this.post('/pairing/redeem', { code, publicKey: owner.publicKey }, owner);
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(result.pairingId) || !/^[A-Za-z0-9_-]{20,64}$/.test(result.grant) || result.expiresIn !== 300) throw new Error('Invalid pairing response.');
    owner.pairingId = result.pairingId;await this.store.put(owner);
    this.grant = { value: result.grant, expires: Date.now() + 295000, pairingId: result.pairingId };
  }
  async challenge(owner) {
    const requestId = b64(this.crypto.getRandomValues(new Uint8Array(32)));
    const lookup = owner.registrationId ? { registrationId: owner.registrationId } : owner.pairingId ? { pairingId: owner.pairingId } : null;
    if (!lookup) throw new Error('Enter a fresh LCD pairing code first.');
    const result = await this.post('/registration/challenge', { ...lookup, requestId, issuedAt: Math.floor(Date.now() / 1000) }, owner);
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(result.registrationId) || !/^[A-Za-z0-9_-]{20,64}$/.test(result.nonce) ||
      !Number.isSafeInteger(result.version) || result.version < 0 || !Number.isSafeInteger(result.authorizedUntil) || result.authorizedUntil <= Date.now() / 1000) throw new Error('Invalid registration authorization.');
    return result;
  }
  async register(token, deviceName = 'Android browser') {
    const owner = await this.record();let result;
    if (this.grant && this.grant.expires > Date.now() && this.grant.pairingId === owner.pairingId) {
      result = await this.post('/register', { pairingId: owner.pairingId, grant: this.grant.value, token, deviceName }, owner);
      if (result.registered !== true || !/^[A-Za-z0-9_-]{20,64}$/.test(result.registrationId) || !Number.isSafeInteger(result.authorizedUntil)) throw new Error('Registration was not confirmed.');
      this.grant = null;
    } else {
      const auth = await this.challenge(owner);
      const response = await this.post('/registration/refresh', { registrationId: auth.registrationId, nonce: auth.nonce, version: auth.version, token, deviceName }, owner);
      if (response.success !== true) throw new Error('Registration refresh was not confirmed.');
      result = { registrationId: auth.registrationId, authorizedUntil: auth.authorizedUntil };
    }
    owner.registrationId = result.registrationId;owner.authorizedUntil = result.authorizedUntil;await this.store.put(owner);return result;
  }
  async reconcile() {
    const owner = await this.record();const auth = await this.challenge(owner);
    owner.registrationId = auth.registrationId;owner.authorizedUntil = auth.authorizedUntil;await this.store.put(owner);
    // Reconciliation establishes ownership only. Refresh with the current FCM token still confirms enabled registration.
    this.grant = null;return auth;
  }
  async sendTest() {
    const owner = await this.record();const auth = await this.challenge(owner);
    const result = await this.post('/registration/test-notification', {
      registrationId: auth.registrationId, nonce: auth.nonce, version: auth.version
    }, owner);
    if (result.accepted !== true || result.displayConfirmed !== false) throw new Error('FCM acceptance was not confirmed. Check this phone before retrying.');
    return result;
  }
  async unregister() {
    const owner = await this.record();const auth = await this.challenge(owner);
    const result = await this.post('/unregister', { registrationId: auth.registrationId, nonce: auth.nonce, version: auth.version }, owner);
    if (result.success !== true) throw new Error('Unregistration was not confirmed.');
    this.grant = null;await this.store.clear();
  }
}
