import { onlineApiUrl } from './online-api-settings.js';
class IncubatorReadError extends Error {}

// RLS determines ownership. No administrator key or caller-supplied owner ID.
export async function readIncubators(token, fetcher = globalThis.fetch.bind(globalThis), localWorker = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    let base;
    try {
      base = new URL(onlineApiUrl);
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error();
    } catch { throw new IncubatorReadError('Online API configuration is invalid. An HTTPS origin is required.'); }
    const response = await fetcher(localWorker ? 'http://127.0.0.1:8787/online/incubators' : base.origin + '/online/incubators', {
      method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      let stage = '';
      // Read only a bounded error envelope; display fixed allowlisted text only.
      if (response.status === 503) {
        try {
          const reader = response.body?.getReader();
          if (reader) {
            let text = ''; let size = 0; const decoder = new TextDecoder();
            while (true) {
              const part = await reader.read(); if (part.done) break;
              size += part.value.length;
              if (size > 1024) { await reader.cancel(); text = ''; break; }
              text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
            const label = JSON.parse(text)?.error;
            stage = label === 'User authentication unavailable' ? ' Supabase session verification is unavailable.' :
              label === 'Incubator lookup unavailable' ? ' Supabase record lookup or ownership validation failed.' :
              label === 'Online service unavailable' ? ' The Worker encountered a network or response-processing failure.' : '';
          }
        } catch { /* Provider text and parsing errors are never displayed. */ }
      }
      const reason = response.status === 401 ? 'Sign in again; the Worker did not accept this session.' :
        response.status === 403 ? 'The Worker rejected this website origin or request.' :
        response.status === 503 ? 'The Worker could not complete its Supabase lookup.' : 'The lookup request was rejected.';
      throw new IncubatorReadError(`Incubator lookup failed (HTTP ${response.status}). ${reason}${stage}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks = []; let size = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 16384) { await reader.cancel(); throw new Error(); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let result;
    try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new IncubatorReadError('The Worker returned a malformed incubator response. Try again later.'); }
    const rows = result?.incubators;
    if (!Array.isArray(rows) || rows.length > 20 || rows.some(row =>
      !row || !['id', 'device_name', 'device_id'].every(key => typeof row[key] === 'string' && row[key].length <= 256))) throw new IncubatorReadError('The Worker returned a malformed incubator response. Try again later.');
    return rows.map(({ id, device_name, device_id }) => ({ id, device_name, device_id }));
  } catch (error) {
    if (error instanceof IncubatorReadError) throw error;
    if (localWorker && error?.name === 'AbortError') throw new Error('Local Worker lookup timed out. Check the server on 127.0.0.1:8787.');
    if (localWorker && error instanceof TypeError) throw new Error('Cannot reach the local Worker, or the browser blocked its response. Check port 8787 and the allowed website origin.');
    if (error?.name === 'AbortError') throw new Error('The deployed Worker lookup timed out. Check your connection and retry.');
    if (error instanceof TypeError) throw new Error('Cannot reach the deployed Worker, or the browser blocked its response. Check internet access and the allowed website origin.');
    throw new Error('Unable to load your incubator. Check your connection and Supabase access policies, then sign in again.');
  } finally { clearTimeout(timer); }
}
