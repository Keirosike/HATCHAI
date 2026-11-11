// Browser integration with all requests intercepted. No devices or cloud services.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.HATCH_PLAYWRIGHT_MODULE || 'C:/Users/LENOVO/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core');
const root = path.resolve(__dirname, '..');
const checks = [];
const check = (condition, message) => { assert.ok(condition, message); checks.push(message); };
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();const errors = [], logs = [], forbidden = [];
    page.on('pageerror', error => errors.push(error.message));page.on('console', entry => logs.push(entry.text()));
    let status = 200, rows = [{ id: '87ce3cf3-a455-4bc3-a7bb-049882d985fa', device_name: '<img src=x onerror=alert(1)>', device_id: 'controller' }], workerCalls = 0;
    let delayed = null, hold = false;
    await page.clock.install({ time: new Date('2026-11-09T08:00:00Z') });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://dihufafcztqjuudjeqdm.supabase.co') {
        if (url.pathname === '/auth/v1/token') return route.fulfill({ json: {
          access_token: 'synthetic-memory-token'.repeat(3), token_type: 'bearer', expires_in: 3600 } });
        if (url.pathname === '/auth/v1/user') return route.fulfill({ json: { id: '00000000-0000-4000-8000-000000000001', role: 'authenticated' } });
        if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
        forbidden.push(url.pathname);return route.abort();
      }
      if (url.origin === 'https://hatchai.kurtzidrickguno-robles.workers.dev') {
        if(url.pathname.endsWith('/telemetry'))return route.fulfill({status:503,json:{error:'Telemetry disabled in isolated fixture'}});
        if(url.pathname==='/online/push/status')return route.fulfill({json:{subscriptions:[]}});
        workerCalls++;
        check(url.pathname === '/online/incubators' && !url.search && route.request().method() === 'GET', 'Only verified Worker read endpoint used');
        check(route.request().headers().authorization === 'Bearer ' + 'synthetic-memory-token'.repeat(3), 'In-memory user token sent only in Authorization');
        if (hold) { delayed = route;return; }
        if (status === 'network') return route.abort();
        return route.fulfill({ status, json: status === 200 ? { incubators: rows } : { error: 'private-provider-text' } });
      }
      if (url.origin === 'https://shared.test') {
        if (url.pathname.startsWith('/api/') || url.pathname === '/scan-wifi') { forbidden.push(url.pathname);return route.abort(); }
        const relative = url.pathname.slice(1);
        const file = path.resolve(root, 'public', relative);
        if (file.startsWith(path.join(root, 'public') + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          return route.fulfill({ path: file, contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.webp': 'image/webp' })[path.extname(file)] });
        }
      }
      forbidden.push(url.origin + url.pathname);return route.abort();
    });
    await page.goto('https://shared.test/online-login.html');
    const login = async () => {
      await page.locator('#email').fill('owner@example.test');await page.locator('#password').fill('synthetic-password');
      await page.locator('#submit').click();await page.waitForFunction(() => !document.getElementById('submit').disabled);
    };
    await login();
    if(await page.locator('#confirmModal.active').count())await page.locator('#modalCancelBtn').click();
    check(await page.locator('#onlineDashboard').isVisible(), 'Canonical dashboard mounted in same signed-in document');
    check(await page.locator('#onlineLogin').isHidden(), 'Sign-in panel gives way to existing dashboard layout');
    check((await page.locator('#status').textContent()).includes('Verified through deployed Worker'), 'Verified Worker success retained');
    await page.setViewportSize({width:1280,height:900});
    await page.locator('#navLinks a[href="#settings"]').click();
    const ownerOption=page.locator('select[aria-label="Incubator"] option');
    check((await ownerOption.textContent()).includes('<img'),'Untrusted record name displayed as text in the owner selector');
    check(await ownerOption.locator('img').count()===0,'Record cannot inject markup');
    await page.locator('#navLinks a[href="#dashboard"]').click();
    await page.locator('#tempValue').waitFor();await page.setViewportSize({width:390,height:844});
    for (const id of ['tempValue', 'humidityValue', 'hatchDayValue', 'turnsTodayValue', 'lastAnomalyValue']) {
      check(await page.locator('#' + id).textContent() === 'Unavailable', id + ' does not invent readings, predictions or counts');
    }
    check((await page.locator('#lastUpdated').textContent()).includes('unavailable'), 'No fabricated synchronization timestamp');
    check(await page.locator('#dashboardBatchSelect').isDisabled(), 'Unavailable batches cannot be selected');
    check(await page.locator('#navLinks li:not([hidden])').count() === 5, 'Shared page navigation remains available online');
    check(await page.locator('#environmentChart').count() === 1, 'Existing canvas chart reused');
    check(await page.evaluate(() => { try { HatchDashboard.init({ adapter: { mode: 'local' } });return false; } catch { return true; } }), 'Second adapter cannot initialize over active dashboard');
    await page.locator('.filter-btn[data-range="day"]').click();
    check(await page.locator('.filter-btn[data-range="day"]').getAttribute('class') === 'filter-btn active', 'Existing chart filter interaction reused');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile dashboard has no horizontal overflow');
    check(await page.evaluate(() => !window.HatchEspApi && !window.HatchAuthSession && !window.HatchBatchStore), 'Online bundle loads no local API, session or storage modules');
    check(await page.evaluate(() => Object.keys(localStorage).every(key=>key.startsWith('hatchai-push-onboarding-v1:')) && sessionStorage.length === 0), 'Online state and tokens remain outside browser storage');
    for (const failure of [401, 403, 'network', 200]) {
      status = failure; rows = [];
      await page.locator('#refreshIncubator').click();await page.waitForFunction(() => !document.getElementById('refreshIncubator').disabled);
      const text=await page.locator('#status').textContent();
      check(text.includes('not verified'),'Refresh safely handles '+failure);
      check(await page.locator('#tempValue').textContent()==='Unavailable','Failed or missing access clears readings');
    }
    await page.clock.fastForward(3600000);
    await page.locator('#refreshIncubator').click();await page.waitForFunction(() => !document.getElementById('refreshIncubator').disabled);
    check((await page.locator('#safetyBanner').textContent()).includes('Sign in again'), 'Expired in-memory session fails closed');
    await page.evaluate(()=>document.getElementById('logout').click());await page.locator('#logoutConfirm').click();await page.locator('#login').waitFor({ state: 'visible' });
    check(await page.locator('#onlineDashboard').isHidden(), 'Sign-out removes protected dashboard');
    status = 200;rows = [{ id: '87ce3cf3-a455-4bc3-a7bb-049882d985fa', device_name: 'Owner incubator', device_id: 'controller' }];
    await login();check(await page.locator('#onlineDashboard').isVisible(), 'New sign-in reinitializes one dashboard instance');
    const output = path.join(root, 'dist/sprint1-review');fs.mkdirSync(output, { recursive: true });
    for (const width of [320, 390, 640, 768, 900, 901, 942, 1000, 1100, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      check(await page.locator('#onlineDashboard .dashboard-grid .value').evaluateAll(elements => elements.every(element => {
        const range = document.createRange();range.selectNodeContents(element);
        return range.getClientRects().length === 1 && element.scrollWidth <= element.clientWidth;
      })), 'Unavailable status stays on one unclipped line at ' + width + 'px');
    }
    await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
    check(await page.locator('#onlineDashboard .dashboard-grid .value').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth)), 'Unavailable status fits with 125% CSS zoom');
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'online-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Desktop dashboard has no horizontal overflow');
    await page.screenshot({ path: path.join(output, 'online-desktop.png'), fullPage: true });
    hold = true;await page.clock.fastForward(60001);
    await page.waitForFunction(() => document.getElementById('onlineDashboard').hidden === false);
    // Route callback receives the pending request while UI remains interactive.
    for (let i = 0; i < 100 && !delayed; i++) await new Promise(resolve => setTimeout(resolve, 20));
    check(!!delayed, 'Bounded background account refresh exercised');
    await page.evaluate(()=>document.getElementById('logout').click());await page.locator('#logoutConfirm').click();await page.locator('#login').waitFor({ state: 'visible' });
    await delayed.fulfill({ json: { incubators: rows } });
    check(await page.locator('#onlineDashboard').isHidden(), 'Late completion after logout cannot restore dashboard');
    check(forbidden.length === 0, 'No local endpoints, camera addresses or unexpected destinations requested');
    check(!logs.join('\n').includes('synthetic-memory-token') && !logs.join('\n').includes('synthetic-password') && !logs.join('\n').includes('private-provider-text'), 'Console contains no credentials or provider details');
    check(errors.length === 0, 'No browser JavaScript exceptions');
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message);process.exitCode = 1; });
