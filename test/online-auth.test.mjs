import test from 'node:test';
import assert from 'node:assert/strict';
import { HatchaiOnlineAuth } from '../public/supabase-auth.js';
const id = '17275f94-f94b-4f89-b1c4-752000000000'; // Public synthetic fixture.
const token = 'test-access-token-'.repeat(4);
const session = { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: 'synthetic-refresh-not-retained' };
const user = { id, role: 'authenticated', is_anonymous: false };
test('email/password sign-in requires a separate Supabase user verification', async () => {
  const calls = [];const auth = new HatchaiOnlineAuth({ fetcher: async (url, options) => {
    calls.push({ url, options });return Response.json(calls.length === 1 ? session : user);
  } });
  const result = await auth.signIn(' owner@example.test ', 'synthetic-password');
  assert.equal(result.userId, id);assert.equal(auth.accessToken(), token);assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://dihufafcztqjuudjeqdm.supabase.co/auth/v1/token?grant_type=password');
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'owner@example.test', password: 'synthetic-password' });
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0].options.redirect, 'error');assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(JSON.stringify(auth).includes(token), false);assert.equal(JSON.stringify(result).includes(token), false);
});
test('failed user verification cannot create a session or echo a provider body', async () => {
  let count = 0;const auth = new HatchaiOnlineAuth({ fetcher: async () => ++count === 1 ? Response.json(session) : Response.json({ message: 'sensitive-provider-fixture' }, { status: 401 }) });
  await assert.rejects(auth.signIn('owner@example.test', 'synthetic-password'), error => !error.message.includes('sensitive-provider-fixture'));
  assert.throws(() => auth.accessToken());
});
test('expired, anonymous, malformed and oversized responses fail closed', async () => {
  for (const value of [{ ...session, expires_in: 0 }, { ...session, access_token: '' }, { ...session, token_type: 'other' }]) {
    const auth = new HatchaiOnlineAuth({ fetcher: async () => Response.json(value) });await assert.rejects(auth.signIn('owner@example.test', 'synthetic-password'));assert.throws(() => auth.accessToken());
  }
  for (const value of [{ ...user, is_anonymous: true }, { ...user, role: 'service_role' }, { ...user, id: 'bad' }]) {
    let count = 0;const auth = new HatchaiOnlineAuth({ fetcher: async () => Response.json(++count === 1 ? session : value) });
    await assert.rejects(auth.signIn('owner@example.test', 'synthetic-password'));assert.throws(() => auth.accessToken());
  }
  const oversized = new HatchaiOnlineAuth({ fetcher: async () => new Response('x'.repeat(17000)) });
  await assert.rejects(oversized.signIn('owner@example.test', 'synthetic-password'));
});
test('expiry and local-scope logout clear access without affecting other phones', async () => {
  let time = 1000;const calls = [];const auth = new HatchaiOnlineAuth({ now: () => time, fetcher: async url => {
    calls.push(url);return url.includes('logout') ? new Response(null, { status: 204 }) : Response.json(url.endsWith('/user') ? user : session);
  } });
  await auth.signIn('owner@example.test', 'synthetic-password');await auth.signOut();assert.throws(() => auth.accessToken());
  assert.ok(calls.at(-1).endsWith('logout?scope=local'));
  await auth.signIn('owner@example.test', 'synthetic-password');time += 3600000;assert.throws(() => auth.accessToken());
});
test('failed sign-out still drops the in-memory credential', async () => {
  const auth = new HatchaiOnlineAuth({ fetcher: async url => {
    if (url.includes('logout')) throw new Error('synthetic-network-failure');return Response.json(url.endsWith('/user') ? user : session);
  } });
  await auth.signIn('owner@example.test', 'synthetic-password');await assert.rejects(auth.signOut());assert.throws(() => auth.accessToken());
});
test('duplicate sign-in is refused and cancellation fences late completion', async () => {
  let release;const auth = new HatchaiOnlineAuth({ fetcher: async url => {
    if (url.includes('/token?')) await new Promise(resolve => { release = resolve; });
    return Response.json(url.endsWith('/user') ? user : session);
  } });
  const first = auth.signIn('owner@example.test', 'synthetic-password');
  await assert.rejects(auth.signIn('owner@example.test', 'synthetic-password'));await auth.signOut();release();
  await assert.rejects(first);assert.throws(() => auth.accessToken());
});
