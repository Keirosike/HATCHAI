import { supabaseUrl, supabasePublishableKey } from './cloud-notification-settings.js';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
class AuthResponseError extends Error {}
export class HatchaiOnlineAuth {
  #session = null;
  #busy = false;
  #generation = 0;
  constructor({ fetcher = globalThis.fetch.bind(globalThis), now = () => Date.now() } = {}) {
    this.fetcher = fetcher;this.now = now;
  }
  async request(path, { body, token } = {}) {
    if (supabaseUrl !== 'https://dihufafcztqjuudjeqdm.supabase.co' || !supabasePublishableKey.startsWith('sb_publishable_')) throw new Error('Online login configuration unavailable.');
    const controller = new AbortController();const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await this.fetcher(supabaseUrl + '/auth/v1/' + path, {
        method: body !== undefined || path.startsWith('logout') ? 'POST' : 'GET',
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { apikey: supabasePublishableKey, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
      if (!response.ok) throw new AuthResponseError(response.status === 400 || response.status === 401 || response.status === 403 ?
        'Sign-in was not accepted. Check your email, password and account confirmation.' : 'Online authentication is unavailable. Try again later.');
      if (response.status === 204) return null;
      const reader = response.body?.getReader();if (!reader) throw new AuthResponseError('Invalid authentication response.');
      const chunks = [];let size = 0;
      while (true) { const part = await reader.read();if (part.done) break;size += part.value.length;
        if (size > 16384) { await reader.cancel();throw new AuthResponseError('Invalid authentication response.'); }chunks.push(part.value); }
      const bytes = new Uint8Array(size);let offset = 0;for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.length; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (error) {
      // Never display provider bodies, passwords, tokens or raw network errors.
      if (error instanceof AuthResponseError) throw error;
      throw new Error('Unable to complete online authentication. Check your connection and retry.');
    } finally { clearTimeout(timer); }
  }
  async signIn(email, password) {
    if (this.#busy) throw new Error('A sign-in request is already running.');
    if (typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        typeof password !== 'string' || !password || password.length > 1024) throw new Error('Enter your existing Supabase account email and password.');
    this.#busy = true;this.#session = null;const generation = ++this.#generation;
    try {
      const started = this.now();
      const result = await this.request('token?grant_type=password', { body: { email: email.trim(), password } });
      if (typeof result?.access_token !== 'string' || !/^[A-Za-z0-9._-]{32,8192}$/.test(result.access_token) ||
          result.token_type?.toLowerCase() !== 'bearer' || !Number.isSafeInteger(result.expires_in) || result.expires_in < 60 || result.expires_in > 86400) throw new Error('Invalid authentication response.');
      const user = await this.request('user', { token: result.access_token });
      if (!uuid(user?.id) || user.role !== 'authenticated' || user.is_anonymous === true) throw new Error('Invalid authentication response.');
      if (generation !== this.#generation) throw new Error('Sign-in was cancelled.');
      const expiresAt = started + result.expires_in * 1000 - 30000;
      if (expiresAt <= this.now()) throw new Error('Sign-in expired. Please retry.');
      // Deliberately no password, refresh-token or browser-storage persistence.
      this.#session = { token: result.access_token, userId: user.id, expiresAt };
      return { userId: user.id, expiresAt };
    } finally { password = '';this.#busy = false; }
  }
  userId() { this.accessToken(); return this.#session.userId; }
  accessToken() {
    if (!this.#session || this.#session.expiresAt <= this.now()) { this.#session = null;throw new Error('Sign in again to continue.'); }
    return this.#session.token;
  }
  async signOut() {
    const session = this.#session;this.#session = null;++this.#generation;
    if (session && session.expiresAt > this.now()) await this.request('logout?scope=local', { token: session.token });
  }
}
