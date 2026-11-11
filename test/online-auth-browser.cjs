// Isolated browser with intercepted requests only; no real sign-in or cloud writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.HATCH_PLAYWRIGHT_MODULE || 'C:/Users/LENOVO/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });let checks = 0;
  const check = (value, message) => { assert.ok(value, message);checks++; };
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });const page = await context.newPage();
    const calls = [];let fail = false,releaseFailure;const failureGate=new Promise(resolve=>releaseFailure=resolve);let workerStatus = 200;let workerRows = [{ id: 'record', device_name: 'HATCHAI Incubator', device_id: 'controller' }];let workerCalls = 0;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://hatchai.kurtzidrickguno-robles.workers.dev') {
        workerCalls++;
        check(url.pathname === '/online/incubators' && !url.search, 'fixed production route without token URL');
        check(route.request().headers().authorization === 'Bearer ' + 'synthetic-access-'.repeat(5), 'memory token forwarded in authorization');
        return route.fulfill({ status: workerStatus, json: workerStatus === 200 ? { incubators: workerRows } : { error: 'private-provider-details' } });
      }
      if (url.origin === 'https://dihufafcztqjuudjeqdm.supabase.co') {
        calls.push(url.pathname + url.search);
        if (fail) {await failureGate;return route.fulfill({ status: 401, json: { message: 'provider-private-details' } });}
        if (url.pathname.endsWith('/token')) return route.fulfill({ json: { access_token: 'synthetic-access-'.repeat(5), token_type: 'bearer', expires_in: 3600 } });
        if (url.pathname.endsWith('/user')) return route.fulfill({ json: { id: '12345678-1234-4234-8234-123456789abc', role: 'authenticated' } });
        if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 });
        throw new Error('Unexpected authentication operation');
      }
      const name = url.pathname.slice(1);
      if (url.origin === 'https://hatchai.test' && ['online-login.html', 'online-login.js', 'supabase-auth.js', 'cloud-notification-settings.js', 'incubator-read.js', 'online-api-settings.js'].includes(name)) {
        return route.fulfill({ path: path.join(__dirname, '../public', name), contentType: name.endsWith('.html') ? 'text/html' : 'application/javascript' });
      }
      return route.abort();
    });
    await page.goto('https://hatchai.test/online-login.html');
    check(await page.locator('#email').getAttribute('autocomplete') === 'username', 'password-manager username field');
    check(await page.locator('#password').getAttribute('autocomplete') === 'current-password', 'password-manager password field');
    await page.locator('#visibility').click();check(await page.locator('#password').getAttribute('type') === 'text', 'show password');
    await page.locator('#email').fill('owner@example.test');await page.locator('#password').fill('synthetic-password');await page.locator('#submit').click();
    await page.locator('#logout').waitFor({ state: 'visible' });check(calls.length === 2, 'token request plus independent user verification');
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('Verified through deployed Worker'));
    check(workerCalls === 1, 'only authenticated Worker lookup confirms deployed status');
    check(await page.locator('#password').inputValue() === '', 'password cleared');
    check(await page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0), 'no session or password in browser storage');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no mobile horizontal scrolling');
    await page.locator('#logout').click();await page.locator('#logoutConfirm').click();await page.locator('#login').waitFor({ state: 'visible' });
    check(calls.at(-1).endsWith('?scope=local'), 'sign-out scoped to this session');
    for (const code of [401, 403, 503, 200]) {
      workerStatus = code;workerRows = [];
      await page.locator('#password').fill('synthetic-password');await page.locator('#submit').click();
      await page.waitForFunction(() => !document.getElementById('submit').disabled);
      const message = await page.locator('#status').textContent();
      check(!message.includes('Verified through deployed Worker') && !message.includes('private-provider-details'), 'failure or empty rows never claim verification or leak bodies');
      check(code === 200 ? message.includes('no incubator') : message.includes(`HTTP ${code}`), 'clear rejected or empty response');
      await page.locator('#logout').click();await page.locator('#logoutConfirm').click();await page.locator('#login').waitFor({ state: 'visible' });
    }
    fail = true;await page.evaluate(()=>{window.failedSkeletonShown=false;new MutationObserver(()=>{if(!document.getElementById('onlineLoading').hidden)window.failedSkeletonShown=true;}).observe(document.getElementById('onlineLoading'),{attributes:true,attributeFilter:['hidden']});});await page.locator('#password').fill('synthetic-password');await page.locator('#submit').click();
    check(await page.locator('#onlineLoading').isHidden(),'no skeleton while password verification is pending');check(await page.locator('#login').isVisible(),'login remains visible during verification');releaseFailure();await page.waitForFunction(() => document.getElementById('status').textContent==='Invalid email or password.');check(await page.evaluate(()=>!window.failedSkeletonShown),'failed sign-in never shows skeleton');
    check(!(await page.locator('#status').textContent()).includes('provider-private-details'), 'provider error details hidden');
    check(await page.locator('#login').isVisible(), 'failed sign-in leaves form available');check(await page.locator('#onlineLoading').isHidden(),'wrong password never leaves a skeleton');check(await page.locator('#status').getAttribute('class')==='status error','same local bottom error style');check(await page.locator('#status').evaluate(e=>e.closest('form')!==null),'error stays at bottom of login form');
    console.log(`Online login browser checks: ${checks} passed; no live network calls`);
  } finally { await browser.close(); }
})().catch(() => { console.error('Online login browser verification failed.');process.exitCode = 1; });
