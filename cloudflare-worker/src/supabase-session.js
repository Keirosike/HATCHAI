import { ApiError, need } from './security.js';
const PROJECT = 'https://dihufafcztqjuudjeqdm.supabase.co';
// A session is checked with Supabase Auth, never by decoding/trusting JWT claims
// or trusting a browser's localStorage user ID. Membership is checked separately.
export function supabaseSessionVerifier(env, fetcher = globalThis.fetch.bind(globalThis)) {
  return async authorization => {
    need(env.SUPABASE_URL === PROJECT && typeof env.SUPABASE_PUBLISHABLE_KEY === 'string' &&
      /^sb_publishable_[A-Za-z0-9_-]{8,200}$/.test(env.SUPABASE_PUBLISHABLE_KEY), 503, 'User authentication unavailable');
    need(typeof authorization === 'string' && /^Bearer [A-Za-z0-9._-]{32,8192}$/.test(authorization), 401, 'Sign in required');
    try {
      const response = await fetcher(PROJECT + '/auth/v1/user', { method: 'GET', redirect: 'manual',
        signal: AbortSignal.timeout(8000), headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization } });
      if (response.status === 401 || response.status === 403) throw new ApiError(401, 'Sign in required');
      need(response.ok && response.status < 300, 503, 'User authentication unavailable');
      const reader = response.body?.getReader();need(reader, 503, 'User authentication unavailable');
      const chunks = [];let size = 0;
      while (true) { const part = await reader.read();if (part.done) break;size += part.value.length;
        if (size > 16384) { await reader.cancel();throw new ApiError(503, 'User authentication unavailable'); }chunks.push(part.value); }
      const bytes = new Uint8Array(size);let offset = 0;for (const chunk of chunks) { bytes.set(chunk, offset);offset += chunk.length; }
      const user = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      need(typeof user?.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) &&
        user.role === 'authenticated' && user.is_anonymous !== true, 401, 'Sign in required');
      return Object.freeze({ id: user.id });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'User authentication unavailable');
    }
  };
}
