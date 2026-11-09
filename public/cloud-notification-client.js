// Adapter for the future verified Supabase session. Not activated by index.html.
// Existing LCD ownership/registration remains intact until migration is tested.
import { WORKER } from './pairing-client.js';
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
export class CloudNotificationClient {
  constructor({ accessToken, fetcher = globalThis.fetch.bind(globalThis), browserId, incubatorId }) {
    if (typeof accessToken !== 'function' || !validId(browserId) || !validId(incubatorId)) throw new Error('Authenticated notification configuration unavailable.');
    this.accessToken = accessToken;this.fetcher = fetcher;this.browserId = browserId;this.incubatorId = incubatorId;
  }
  async post(path, body) {
    const token = await this.accessToken();
    if (typeof token !== 'string' || token.length < 32 || token.length > 8192 || /\s/.test(token)) throw new Error('Sign in before enabling notifications.');
    const controller = new AbortController();const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await this.fetcher(WORKER + path, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error',
        cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body) });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Sign-in or incubator access was not accepted.' : 'Notification storage was not confirmed.');
      const reader = response.body?.getReader();if (!reader) throw new Error('Invalid notification response.');
      const chunks = [];let size = 0;
      while (true) { const part = await reader.read();if (part.done) break;size += part.value.length;
        if (size > 2048) { await reader.cancel();throw new Error('Invalid notification response.'); } chunks.push(part.value); }
      const bytes = new Uint8Array(size);let offset = 0;for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.length; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally { clearTimeout(timeout); }
  }
  async register(token, deviceName = '') {
    const result = await this.post('/cloud-notifications/register', { incubatorId: this.incubatorId, browserId: this.browserId, token, deviceName });
    if (result?.registered !== true) throw new Error('Notification storage was not confirmed.');
    return { registered: true };
  }
  async unregister() {
    const result = await this.post('/cloud-notifications/unregister', { incubatorId: this.incubatorId, browserId: this.browserId });
    if (result?.registered !== false) throw new Error('Notification removal was not confirmed.');
    return { registered: false };
  }
}
