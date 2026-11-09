import { ApiError, need, b64 } from './security.js';

export const TEST_NOTIFICATION = Object.freeze({
  title: 'HATCHAI Test Notification',
  body: 'Your HATCHAI notification system is working.'
});
const PROJECT = 'hatchai-8d34c';
const OAUTH = 'https://oauth2.googleapis.com/token';
const encoder = new TextEncoder();
const sessions = new WeakMap();

// Only Google HTTPS endpoints are used. Neither URLs nor credentials come from a browser.
async function googleJson(url, options, deadline) {
  try {
    if (Date.now() >= deadline) throw new Error('Deadline');
    // Workerd supports manual/follow, not browser redirect:error. Reject redirects explicitly.
    const response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(Math.min(8000, deadline - Date.now())) });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();throw new Error('Provider redirect rejected');
    }
    const reader = response.body?.getReader(); need(reader, 502, 'Notification provider unavailable');
    const chunks = []; let size = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 16384) { await reader.cancel(); throw new Error('Oversized provider response'); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let body; try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { body = null; }
    return { ok: response.ok, status: response.status, body };
  } catch {
    // A timeout can mean Google accepted the send. Never automatically retry a send.
    throw new ApiError(502, 'Test request outcome is unknown. Check this phone before sending another test.');
  }
}

export async function prepareTestDelivery(env) {
  need(env.MANUAL_TEST_NOTIFICATIONS_ENABLED === 'true', 503, 'Manual test notifications are disabled');
  return prepareDelivery(env, false);
}

// Shares the existing Google OAuth/FCM transport; no second sender or project.
// No route currently activates this adapter. Real Supabase integration is required.
export async function prepareChickDelivery(env) {
  need(env.CHICK_NOTIFICATIONS_ENABLED === 'true', 503, 'Chick notifications are disabled');
  const send = await prepareDelivery(env, true);
  return async (token, content) => {
    need(content?.title === 'HATCHAI — Hatched Chick Detected!' &&
      typeof content.body === 'string' && content.body.length <= 240 &&
      /^A hatched chick was detected in the (Upper|Lower) Incubation Batch/.test(content.body) &&
      /^https:\/\/hatchai-8d34c\.web\.app\/\?batch=[A-Za-z0-9_-]{1,64}$/.test(content.url) &&
      typeof content.tag === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(content.tag));
    try { return await send(token, content); }
    catch { return { outcome: 'unknown' }; }
  };
}

async function prepareDelivery(env, cloud) {
  need(typeof env.FCM_SERVICE_ACCOUNT_JSON === 'string', 503, 'Test notification configuration unavailable');
  let session = sessions.get(env);
  if (!session || session.source !== env.FCM_SERVICE_ACCOUNT_JSON) {
    try {
      const account = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
      need(account.type === 'service_account' && account.project_id === PROJECT &&
        typeof account.client_email === 'string' && /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(account.client_email) &&
        (!account.token_uri || account.token_uri === OAUTH) && typeof account.private_key === 'string');
      const match = /^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----\s*$/.exec(account.private_key);
      need(match && match[1].length <= 16384);
      const der = Uint8Array.from(atob(match[1].replace(/\s/g, '')), c => c.charCodeAt(0));
      const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
      need(key.algorithm.modulusLength >= 2048);
      session = { source: env.FCM_SERVICE_ACCOUNT_JSON, email: account.client_email, key, access: null, pending: null };
      sessions.set(env, session);
    } catch { throw new ApiError(503, 'Test notification configuration unavailable'); }
  }
  return async (token, content) => {
    const deadline = Date.now() + 10000;
    const now = Math.floor(Date.now() / 1000);
    if (!session.access || session.access.expires <= now + 60) {
      if (!session.pending) session.pending = (async () => {
        const header = b64(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
        const claims = b64(encoder.encode(JSON.stringify({ iss: session.email,
          scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: OAUTH, iat: now, exp: now + 3600 })));
        const unsigned = `${header}.${claims}`;
        const signature = b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', session.key, encoder.encode(unsigned)));
        const response = await googleJson(OAUTH, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }) }, deadline);
        need(response.ok && typeof response.body?.access_token === 'string' && response.body.access_token.length <= 4096 &&
          Number.isSafeInteger(response.body.expires_in) && response.body.expires_in >= 120 && response.body.expires_in <= 3600,
        502, 'Notification provider authorization failed');
        session.access = { token: response.body.access_token, expires: now + response.body.expires_in };
      })().finally(() => { session.pending = null; });
      await session.pending;
    }
    const response = await googleJson(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access.token}` },
      body: JSON.stringify({ message: { token, notification: cloud ? { title: content.title, body: content.body } : TEST_NOTIFICATION,
        data: { type: cloud ? 'hatchai-chick-detected' : 'hatchai-manual-test', url: cloud ? content.url : 'https://hatchai-8d34c.web.app/' },
        webpush: { headers: { TTL: '300', Urgency: 'normal' },
          notification: { tag: cloud ? content.tag : 'hatchai-manual-test' }, fcm_options: { link: cloud ? content.url : 'https://hatchai-8d34c.web.app/' } } } })
    }, deadline);
    if (response.status === 401) session.access = null;
    if (cloud) {
      if (response.status === 404 && response.body?.error?.details?.some?.(item => item.errorCode === 'UNREGISTERED')) return { outcome: 'invalid-token' };
      if (response.status === 429 || response.status === 503) return { outcome: 'retryable' };
      if (!response.ok) return { outcome: 'failed' };
      return { outcome: typeof response.body?.name === 'string' && response.body.name.startsWith(`projects/${PROJECT}/messages/`) ? 'accepted' : 'unknown' };
    }
    need(response.ok && typeof response.body?.name === 'string' && response.body.name.startsWith(`projects/${PROJECT}/messages/`),
      502, 'FCM did not confirm the test. Check notification configuration and refresh this phone registration.');
    return { accepted: true, displayConfirmed: false };
  };
}
