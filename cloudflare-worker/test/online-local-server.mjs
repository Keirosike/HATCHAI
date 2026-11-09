// Node HTTP bridge to the real Worker handler, not a workerd runtime test.
// Loopback only; the sole exposed route performs read-only Supabase requests.
import http from 'node:http';
import worker from '../src/index.js';
import { supabaseUrl, supabasePublishableKey } from '../../public/cloud-notification-settings.js';
const env = { SUPABASE_URL: supabaseUrl, SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey,
  ONLINE_ALLOWED_ORIGINS: 'http://127.0.0.1:8080' };
const server = http.createServer(async (incoming, outgoing) => {
  try {
    incoming.resume();
    if (incoming.headers.host !== '127.0.0.1:8787' || incoming.url !== '/online/incubators' ||
        !['GET', 'OPTIONS'].includes(incoming.method) || incoming.headers.origin !== 'http://127.0.0.1:8080') {
      outgoing.writeHead(403, { 'Cache-Control': 'no-store' }); outgoing.end(); return;
    }
    const headers = new Headers();
    for (const name of ['origin', 'authorization', 'access-control-request-method', 'access-control-request-headers']) {
      if (typeof incoming.headers[name] === 'string') headers.set(name, incoming.headers[name]);
    }
    const response = await worker.fetch(new Request('http://127.0.0.1:8787/online/incubators', { method: incoming.method, headers }), env);
    // Fixed route/status only: never log request headers, tokens or provider data.
    console.log(`Local incubator lookup: method=${incoming.method} status=${response.status}`);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(503, { 'Cache-Control': 'no-store' }); outgoing.end(); }
});
server.requestTimeout = 20000; server.headersTimeout = 10000; server.maxHeadersCount = 20;
server.on('error', error => {
  const code = ['EADDRINUSE', 'EACCES', 'EPERM'].includes(error.code) ? error.code : 'UNAVAILABLE';
  console.error(`Local Worker test server unavailable: ${code}.`); process.exitCode = 1;
});
server.listen(8787, '127.0.0.1', () => console.log('Read-only local Worker test ready on 127.0.0.1:8787. No request or credential logging.'));
