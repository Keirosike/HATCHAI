// Run via Firebase Hosting emulator. Supabase/Worker traffic is mocked.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { chromium } = require(process.env.HATCH_PLAYWRIGHT_MODULE || 'C:/Users/LENOVO/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core');
const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:5005';
let checks = 0;
const check = (ok, message) => { assert.ok(ok, message);checks++; };
(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist/myhatchai/manifest.json')));
  check(manifest.hostingSite === 'myhatchai', 'Deployment target is myhatchai');
  for (const file of manifest.files) {
    const response = await fetch(origin + '/' + file.path);
    check(response.status === 200, 'Packaged asset served: ' + file.path);
    const bytes = Buffer.from(await response.arrayBuffer());
    check(crypto.createHash('sha256').update(bytes).digest('hex') === file.sha256, 'Served asset integrity');
    check(response.headers.get('cache-control') === 'no-store', 'No stale deployment/session cache; received ' + response.headers.get('cache-control'));
    if (file.path.endsWith('.js')) check(/javascript/.test(response.headers.get('content-type')), 'JavaScript MIME type');
  }
  const loginResponse = await fetch(origin + '/online-login.html');
  check(loginResponse.headers.get('content-security-policy').includes('connect-src \'self\' https://dihufafcztqjuudjeqdm.supabase.co https://hatchai.kurtzidrickguno-robles.workers.dev;'), 'Online CSP allows only required backend origins');
  check(loginResponse.headers.get('x-frame-options') === 'DENY', 'Framing denied');
  check(loginResponse.headers.get('x-content-type-options') === 'nosniff', 'MIME sniffing denied');
  for (const route of ['/', '/online', '/dashboard.html']) {
    const response = await fetch(origin + route, { redirect: 'manual' });
    check(response.status === 302 && response.headers.get('location').endsWith('/online-login.html'), 'Explicit login redirect: ' + route);
  }
  for (const route of ['/control.html', '/settings.html', '/camera.html', '/api/control', '/backups/backup.bin', '/.env', '/src/main.cpp']) {
    check((await fetch(origin + route)).status === 404, 'Unpublished route stays unavailable: ' + route);
  }
  check((await fetch(origin + '/push.js')).status === 404, 'Legacy enrollment scripts not published to new origin');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 942, height: 900 } });
    const errors = [], messages = [], network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', entry => messages.push(entry.text()));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());network.push(url.origin + url.pathname);
      if (url.origin === origin) return route.continue();
      const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,apikey,content-type', 'Access-Control-Allow-Methods': 'GET,POST' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (url.origin === 'https://dihufafcztqjuudjeqdm.supabase.co') {
        if (url.pathname === '/auth/v1/token') return route.fulfill({ headers: cors, json: {
          access_token: 'synthetic-hosting-session'.repeat(3), token_type: 'bearer', expires_in: 3600 } });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ headers: cors, json: {
          id: '00000000-0000-4000-8000-000000000001', role: 'authenticated' } });
        if (url.pathname === '/auth/v1/logout') return route.fulfill({ headers: cors, status: 204 });
      }
      if (url.origin === manifest.worker && url.pathname === '/online/incubators') {
        check(route.request().headers().authorization === 'Bearer ' + 'synthetic-hosting-session'.repeat(3), 'Memory session reaches deployed HTTPS Worker URL');
        return route.fulfill({ headers: cors, json: { incubators: [{ id: 'mock-record', device_name: 'Hosting test incubator', device_id: 'controller' }] } });
      }
      assert.fail('Unexpected destination; no request transmitted');
    });
    await page.goto(origin + '/online');
    check(new URL(page.url()).pathname === '/online-login.html', 'Browser reaches real Hosting login route');
    check(await page.locator('#onlineDashboard').isHidden(), 'No dashboard before authentication');
    await page.locator('#email').fill('owner@example.test');await page.locator('#password').fill('synthetic-password');await page.locator('#submit').click();
    await page.locator('#onlineIncubatorInfo').waitFor({ state: 'visible' });
    check((await page.locator('#status').textContent()).includes('Verified through deployed Worker'), 'Hosted assets mount authenticated shared dashboard under CSP');
    check(await page.locator('#onlineDashboard .dashboard-grid .value').evaluateAll(elements => elements.every(element => {
      const range = document.createRange();range.selectNodeContents(element);
      return range.getClientRects().length === 1 && element.scrollWidth <= element.clientWidth;
    })), 'Hosted monitoring labels are single-line and unclipped');
    check(await page.locator('#navLinks li:not([hidden])').count() === 1, 'Online page exposes no hardware-control navigation');
    check(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length === 0), 'FCM service worker remains dormant; notifications are not enabled');
    check(network.filter(url => url.startsWith(origin)).every(url => !/\/api\//.test(url)), 'No private/local API requests');
    await page.locator('#logout').click();await page.locator('#login').waitFor({ state: 'visible' });
    await page.reload();check(await page.locator('#onlineDashboard').isHidden(), 'Reload requires sign-in, without token persistence');
    check(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0), 'No credentials stored by hosted dashboard');
    check(!messages.join('\n').includes('synthetic-hosting-session') && !messages.join('\n').includes('synthetic-password'), 'Credentials absent from console');
    check(errors.length === 0 && !messages.some(message => /Content Security Policy|Refused to/.test(message)), 'No JavaScript or CSP regressions');
  } finally { await browser.close(); }
  console.log('PASS Firebase Hosting emulator: ' + checks + ' checks; browser authentication and Worker mocked; no deployment.');
})().catch(error => { console.error(error.message);process.exitCode = 1; });
