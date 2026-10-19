// Host-only regression checks. Every device API is mocked; no ESP32 is contacted.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.HATCH_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const checks = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message) => { assert.ok(condition, message); checks.push(message); };
async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await predicate()) return;
    await pause(25);
  }
  throw new Error('Timed out waiting for a browser operation');
}
async function tick(page) {
  await page.clock.fastForward(5001);
  await pause(100);
}
async function prepare(page, origin, extra = {}) {
  await page.clock.install({ time: new Date('2026-10-20T04:00:00Z') });
  await page.addInitScript(({ origin, extra }) => {
    const token = 'isolated-ui-test';
    sessionStorage.setItem('hatchaiClientId', token);
    localStorage.setItem('hatchaiActiveSession', JSON.stringify({ token, username: 'test', expiresAt: Date.now() + 3600000 }));
    for (const [key, value] of Object.entries(extra)) localStorage.setItem(key, JSON.stringify(value));
  }, { origin, extra });
}
async function wifiChecks(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const home = { connected: true, ssid: 'Panel WiFi', savedSsid: 'Saved WiFi', connecting: false,
    connectionState: 'connected', requestedSsid: 'Panel WiFi', error: '', credentialsSaved: true,
    ipAddress: '192.168.1.42', rssi: -52, apSsid: 'HatchAI-ESP32', apIpAddress: '192.168.4.1' };
  let state = { ...home };
  let pending = null;
  let outcome = 'connected';
  let scanCalls = 0;
  let statusCalls = 0;
  let connectCalls = 0;
  let forgetCalls = 0;
  let forgetFails = false;
  let active = 0;
  let maxActive = 0;
  let submitted;
  await prepare(page, origin, { hatchaiWifi: { ssid: 'Old cache', connected: true, password: 'old-secret', baseUrl: origin } });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/session/')) return route.fulfill({ json: { ok: true, active: true } });
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      if (url.pathname.endsWith('/status')) {
        statusCalls++;
        if (pending) {
          if (--pending.polls === 0) {
            state = { ...state, connecting: false, connectionState: outcome === 'connected' || outcome === 'unsaved' ? 'connected' : 'failed',
              connected: outcome === 'connected' || outcome === 'unsaved', error: outcome === 'connected' || outcome === 'unsaved' ? '' : outcome,
              ssid: outcome === 'connected' || outcome === 'unsaved' ? pending.ssid : '',
              savedSsid: outcome === 'connected' ? pending.ssid : state.savedSsid, credentialsSaved: outcome === 'connected' };
            pending = null;
          }
        }
        await route.fulfill({ json: state });
      } else if (url.pathname.endsWith('/connect')) {
        connectCalls++;
        submitted = new URLSearchParams(route.request().postData());
        state = { ...state, connected: false, connecting: true, connectionState: 'connecting', requestedSsid: submitted.get('ssid'), error: '' };
        pending = { ssid: submitted.get('ssid'), polls: 2 };
        await route.fulfill({ json: { ...state, accepted: true } });
      } else if (url.pathname.endsWith('/forget')) {
        forgetCalls++;
        if (!forgetFails) state = { ...home, connected: false, ssid: '', savedSsid: '', connecting: false, connectionState: 'idle', rssi: null };
        await route.fulfill({ json: { forgotten: !forgetFails, message: forgetFails ? 'Storage unavailable' : 'Forgotten' } });
      } else throw new Error('Unexpected API: ' + url.pathname);
    } finally { active--; }
  });
  await page.route('**/scan-wifi*', async route => {
    active++;
    maxActive = Math.max(maxActive, active);
    scanCalls++;
    try {
      await route.fulfill({ json: scanCalls === 1 ? { scanning: true } : [
        { ssid: 'Panel WiFi', rssi: -52, secure: true }, { ssid: 'Saved WiFi', rssi: -63, secure: true }, { ssid: 'New WiFi', rssi: -60, secure: true },
        { ssid: 'New WiFi', rssi: -75, secure: true }, { ssid: 'Open Guest', rssi: -65, secure: false },
        { ssid: '', rssi: -80, secure: true }, { ssid: '<img src=x onerror=alert(1)>', rssi: -45, secure: false }
      ] });
    } finally { active--; }
  });
  await page.goto(origin + '/settings.html');
  await until(() => scanCalls === 1);
  await pause(50);
  await tick(page);
  await until(async () => await page.locator('#wifiNetworkList button').count() === 5);
  await page.waitForFunction(() => !document.getElementById('scanWifiBtn').disabled);
  check(scanCalls === 2, 'Wi-Fi scans automatically and deduplicates named networks');
  check(await page.locator('#wifiSsid').count() === 0, 'Settings has no manual SSID input');
  check(await page.locator('main #wifiPassword').count() === 0, 'Settings has no permanent Wi-Fi password form');
  check(await page.locator('#espConnectedSsid').innerText() === 'Panel WiFi', 'Live connection overrides browser cache');
  check(!JSON.parse(await page.evaluate(() => localStorage.getItem('hatchaiWifi'))).password, 'Legacy browser Wi-Fi password is removed');
  check(await page.locator('#wifiNetworkList img').count() === 0, 'SSID text cannot inject HTML');
  check(await page.locator('#wifiNetworkList .wifi-lock').count() === 3, 'Secured networks have lock icons');
  check(!(await page.locator('#wifiNetworkList').innerText()).includes('Hidden network'), 'Unnamed networks do not offer a manual-entry flow');
  await page.locator('#scanWifiBtn').click();
  await until(() => scanCalls === 3);
  await page.waitForFunction(() => !document.getElementById('scanWifiBtn').disabled);
  check(scanCalls === 3, 'Refresh networks starts another scan');
  await page.locator('#wifiNetworkList button').filter({ hasText: 'Panel WiFi' }).click();
  check(await page.locator('#wifiConnectionDetails').isVisible() && connectCalls === 0, 'Tapping the connected network opens its information');
  await page.locator('#wifiNetworkList button').filter({ hasText: 'Saved WiFi' }).click();
  await page.locator('#espWifiBadge').filter({ hasText: 'Connecting' }).waitFor();
  check(submitted.get('ssid') === 'Saved WiFi' && submitted.get('useSaved') === 'true' && submitted.get('password') === '', 'Saved network connects with one tap and no password sent by the browser');
  check(await page.locator('#wifiJoinDialog').isHidden(), 'Saved network does not show a password dialog');
  await tick(page);
  await tick(page);
  await page.locator('#espConnectedSsid').filter({ hasText: 'Saved WiFi' }).waitFor();
  await page.locator('#wifiNetworkList button').filter({ hasText: 'Open Guest' }).click();
  await page.locator('#espWifiBadge').filter({ hasText: 'Connecting' }).waitFor();
  check(submitted.get('password') === '' && submitted.get('useSaved') === 'false', 'Open network connects with one tap and an empty password');
  check(await page.locator('#wifiJoinDialog').isHidden(), 'Open network does not show a password dialog');
  await tick(page);
  await tick(page);
  await page.locator('#espConnectedSsid').filter({ hasText: 'Open Guest' }).waitFor();
  const beforeJoin = connectCalls;
  await page.locator('#wifiNetworkList button').filter({ hasText: 'New WiFi' }).click();
  check(await page.locator('#wifiJoinDialog').isVisible(), 'New secured network opens a password dialog');
  check(await page.locator('#wifiJoinSsid').innerText() === 'New WiFi', 'Dialog shows the selected network name as text');
  await page.locator('#connectWifiBtn').click();
  await page.locator('#wifiJoinError').filter({ hasText: 'Enter the password' }).waitFor();
  check(connectCalls === beforeJoin, 'Empty password does not send a connection request');
  await page.locator('#wifiPassword').fill('cancel-me');
  await page.locator('#cancelWifiJoin').click();
  await page.waitForFunction(() => document.getElementById('wifiPassword').value === '');
  check(await page.locator('#wifiJoinDialog').isHidden(), 'Cancel closes the dialog and clears the password');
  await page.locator('#wifiNetworkList button').filter({ hasText: 'New WiFi' }).click();
  await page.keyboard.press('Escape');
  check(await page.locator('#wifiJoinDialog').isHidden() && connectCalls === beforeJoin, 'Escape closes the dialog without connecting');
  await page.locator('#wifiNetworkList button').filter({ hasText: 'New WiFi' }).click();
  await page.locator('#wifiPassword').fill('p&=?+#test');
  await page.locator('#toggleWifiPassword').click();
  check(await page.locator('#wifiPassword').getAttribute('type') === 'text', 'Show password works');
  await page.locator('#toggleWifiPassword').click();
  check(await page.locator('#wifiPassword').getAttribute('type') === 'password', 'Hide password works');
  await page.setViewportSize({ width: 375, height: 812 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Join dialog fits a 375px phone');
  if (process.env.HATCH_UI_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.HATCH_UI_SCREENSHOT_DIR, 'wifi-select-dialog.png') });
  await page.locator('#connectWifiBtn').click();
  await page.locator('#espWifiBadge').filter({ hasText: 'Connecting' }).waitFor();
  check(submitted.get('ssid') === 'New WiFi' && submitted.get('password') === 'p&=?+#test', 'Connection POST preserves URL-encoded credentials');
  check(await page.locator('#wifiJoinDialog').isHidden(), 'Accepted connection closes the password dialog');
  check(await page.locator('#wifiPassword').inputValue() === '', 'Password is cleared after the acknowledgement');
  check(await page.locator('#scanWifiBtn').isDisabled(), 'Pending connection prevents another scan or connect');
  await tick(page);
  check(await page.locator('#espWifiBadge').innerText() === 'Connecting', 'Connecting state persists until an outcome');
  await tick(page);
  await page.locator('#espConnectedSsid').filter({ hasText: 'New WiFi' }).waitFor();
  check(connectCalls === beforeJoin + 1, 'Status polling never repeats the connect POST');
  async function tryOutcome(nextOutcome, expectedText) {
    outcome = nextOutcome;
    await page.locator('#wifiNetworkList button').filter({ hasText: 'Panel WiFi' }).click();
    await page.locator('#wifiPassword').fill('test-password');
    await page.locator('#connectWifiBtn').click();
    await page.locator('#espWifiBadge').filter({ hasText: 'Connecting' }).waitFor();
    await tick(page);
    await tick(page);
    await page.locator('#wifiCardStatus').filter({ hasText: expectedText }).waitFor();
  }
  await tryOutcome('connection_failed', 'Incorrect password or connection failed');
  check(await page.locator('#espWifiBadge').innerText() === 'Connection failed', 'Connection failure is explicit');
  await tryOutcome('network_unavailable', 'Network unavailable');
  check(await page.locator('#espWifiBadge').innerText() === 'Network unavailable', 'Unavailable network has a distinct state');
  await tryOutcome('unsaved', 'credentials could not be saved');
  check(await page.locator('#espWifiBadge').innerText() === 'Connected', 'Storage failure does not hide a current connection');
  for (const width of [375, 812, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Wi-Fi layout fits at ' + width + 'px');
  }
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#forgetWifiBtn').click();
  await page.waitForFunction(() => !document.getElementById('forgetWifiBtn').disabled);
  check(forgetCalls === 0, 'Cancelling forget sends no POST');
  forgetFails = true;
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#forgetWifiBtn').click();
  await page.locator('#wifiCardStatus').filter({ hasText: 'Storage unavailable' }).waitFor();
  check(Boolean(await page.evaluate(() => localStorage.getItem('hatchaiWifi'))), 'Failed forget preserves browser choices');
  await page.locator('#refreshWifiBtn').click();
  await page.waitForFunction(() => !document.getElementById('refreshWifiBtn').disabled);
  forgetFails = false;
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#forgetWifiBtn').click();
  await page.locator('#espWifiBadge').filter({ hasText: 'Setup requested' }).waitFor();
  check(await page.evaluate(() => localStorage.getItem('hatchaiWifi')) === null, 'Acknowledged forget clears browser choices');
  const afterForget = statusCalls;
  await tick(page);
  check(statusCalls === afterForget, 'Automatic refresh pauses while rejoining setup Wi-Fi');
  check(maxActive === 1, 'Wi-Fi requests never overlap');
  check(errors.length === 0, 'Wi-Fi page has no JavaScript errors');
  await page.close();
}
async function dashboardChecks(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const batches = ['one', 'two'].map((id, index) => ({ id, label: 'Batch ' + (index + 1), name: 'Batch ' + (index + 1),
    chickenType: 'Native', count: 10, laidDate: '2026-10-08', startDate: '2026-10-10',
    targetTemp: '37.8', targetHumidity: '58', status: 'Active', notes: '', selected: index === 0 }));
  await prepare(page, origin, { hatchai_batches: batches });
  await page.addInitScript(() => {
    window.canvasResets = 0;
    window.chartClears = 0;
    for (const property of ['width', 'height']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
      Object.defineProperty(HTMLCanvasElement.prototype, property, { ...descriptor, set(value) { window.canvasResets++; descriptor.set.call(this, value); } });
    }
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function(...args) { window.chartClears++; return clear.apply(this, args); };
  });
  let dataCalls = 0;
  let predictCalls = 0;
  let dataFails = false;
  let temperature = 37.8;
  let active = 0;
  let maxActive = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/session/')) return route.fulfill({ json: { ok: true, active: true } });
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      if (url.pathname === '/api/data') {
        dataCalls++;
        if (dataFails) return await route.fulfill({ status: 503, json: { message: 'Offline' } });
        const series = { labels: ['-5s', 'now'], temperature: [37.7, temperature], humidity: [57, 58] };
        await route.fulfill({ json: { temperature, humidity: 58, relayOn: true, relayStatus: 'Heating ON', relayBadge: 'Bulbs Active',
          motorStatus: 'Idle', motorNote: 'Waiting', predictedDay: 'Generic uptime prediction', hatchDate: 'Generic uptime date',
          lastUpdated: 'tick ' + dataCalls, sensorStatus: 'Connected', clockStatus: 'Ready', rtcTime: '2026-10-20 12:00:00', wifiStatus: 'Online',
          history: { hour: series, day: series, week: series, month: series } } });
      } else if (url.pathname === '/api/predict') {
        predictCalls++;
        await pause(80);
        const batchId = new URLSearchParams(route.request().postData()).get('batchId');
        await route.fulfill({ json: { success: true, batchId, daysRemaining: 10, predictedHatchDay: 21, predictedHatchDate: batchId === 'two' ? '2026-11-01' : '2026-10-30' } });
      } else throw new Error('Unexpected dashboard API: ' + url.pathname);
    } finally { active--; }
  });
  await page.goto(origin + '/dashboard.html');
  await page.locator('#hatchDayValue').filter({ hasText: 'Predicted Hatch Day: Day 21' }).waitFor();
  await until(async () => active === 0 && await page.evaluate(() => window.chartClears > 0));
  await page.evaluate(() => {
    window.stableMutations = [];
    const observer = new MutationObserver(records => window.stableMutations.push(...records.map(record => record.target.parentElement?.id || record.target.id)));
    for (const id of ['tempValue', 'humidityValue', 'hatchDayValue', 'hatchDateValue', 'dashboardExpectedHatch', 'dashboardBatchSelect', 'relayBadge']) {
      observer.observe(document.getElementById(id), { childList: true, characterData: true, attributes: true, subtree: true });
    }
  });
  const initialCanvas = await page.evaluate(() => ({ resets: canvasResets, clears: chartClears }));
  const previousPredictions = predictCalls;
  await tick(page);
  await until(() => predictCalls > previousPredictions && active === 0);
  await pause(50);
  check(await page.evaluate(() => window.stableMutations.length) === 0, 'Unchanged dashboard refresh makes no prediction, selector, or value DOM replacements');
  check(await page.evaluate(() => canvasResets) === initialCanvas.resets, 'Unchanged refresh does not reset the canvas');
  check(await page.evaluate(() => chartClears) === initialCanvas.clears, 'Unchanged history does not clear or redraw the chart');
  check(!(await page.locator('#hatchDateValue').innerText()).includes('Generic uptime'), 'Batch prediction is never replaced by generic uptime text');
  temperature = 38.1;
  const beforeChanged = dataCalls;
  await tick(page);
  await until(() => dataCalls > beforeChanged && active === 0);
  await page.locator('#tempValue').filter({ hasText: '38.1' }).waitFor();
  check(await page.evaluate(() => chartClears) > initialCanvas.clears, 'Changed sensor history redraws the chart');
  check(await page.evaluate(() => canvasResets) === initialCanvas.resets, 'Changed chart data keeps the existing canvas dimensions');
  await page.locator('#dashboardBatchSelect').selectOption('two');
  await page.locator('#hatchDateValue').filter({ hasText: 'Nov' }).waitFor();
  check(await page.locator('#activeBatchValue').innerText() === 'Batch 2 (10 eggs)', 'Selecting another batch still refreshes its prediction');
  dataFails = true;
  await tick(page);
  await page.locator('#lastUpdated').filter({ hasText: 'Connection lost' }).waitFor();
  check((await page.locator('#tempValue').innerText()).includes('38.1'), 'Network failure retains the last reading rather than inserting sample data');
  check(await page.locator('#chartStatus').innerText() === 'Offline - last data', 'Retained chart is marked offline');
  dataFails = false;
  await tick(page);
  await page.locator('#chartStatus').filter({ hasText: 'Live' }).waitFor();
  check(await page.locator('#wifiStatus').innerText() === 'Online', 'Dashboard recovers after the API becomes available');
  check(maxActive === 1, 'Dashboard data and prediction API calls are serialized');
  check(errors.length === 0, 'Dashboard has no JavaScript errors');
  await page.close();
}
async function batchChecks(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page, origin);
  await page.route('**/api/**', route => {
    const endpoint = new URL(route.request().url()).pathname;
    return route.fulfill({ json: endpoint === '/api/predict' ?
      { success: true, incubationDay: Number(new URLSearchParams(route.request().postData()).get('incubationDay')),
        daysRemaining: 10, predictedHatchDay: 21, predictedHatchDate: '2026-10-30', dateSource: 'rtc' } :
      { ok: true, active: true, temperature: 37.8, humidity: 58, sensorStatus: 'Connected', rtcTime: '2026-10-20 12:00:00' } });
  });
  await page.goto(origin + '/batch.html');
  await until(async () => await page.locator('#batchSlots .batch-slot').count() === 2);
  check(await page.locator('#batchTableBody tr[data-id]').count() === 0, 'Fresh browser starts without sample batch records');
  check(await page.locator('#slotCountBadge').innerText() === '0 / 2 Running', 'Batch page shows exactly two empty slots');
  await page.reload();
  check(await page.locator('#batchTableBody tr[data-id]').count() === 0, 'Empty batch list stays empty after reload');
  const common = { type: 'Chicken', targetTemp: '37.8°C', targetHumidity: '58%' };
  const defaults = [
    { ...common, id: 'old-demo-one', label: 'BATCH-001', name: 'Chicken Batch 001', count: 36, laidDate: '2026-04-18', startDate: '2026-04-20',
      status: 'Active', notes: 'Check candling status on Day 14. Maintain stable humidity and automatic egg turning.', selected: true },
    { ...common, id: 'old-demo-two', label: 'BATCH-002', name: 'Chicken Batch 002', count: 30, laidDate: '2026-03-23', startDate: '2026-03-25',
      status: 'Completed', notes: 'Previous completed batch.', selected: false }
  ];
  const own = { ...common, id: 'my-batch', label: 'MY-BATCH', name: 'My Batch', count: 12, laidDate: '2026-10-08', startDate: '2026-10-10', status: 'Active', notes: 'My own eggs' };
  const edited = { ...defaults[0], id: 'edited-demo', notes: 'Edited by the owner', selected: false };
  await page.evaluate(records => localStorage.setItem('hatchai_batches', JSON.stringify(records)), [...defaults, own, edited]);
  await page.reload();
  await until(async () => await page.locator('#batchTableBody tr[data-id]').count() === 2);
  const retained = await page.evaluate(() => HatchBatchStore.loadBatches());
  check(retained.length === 2 && retained.some(record => record.id === own.id) && retained.some(record => record.id === edited.id),
    'Old unchanged demo records are removed while owned and edited records remain');
  check(await page.locator('#batchSlots .batch-slot').count() === 2 && await page.locator('#slotCountBadge').innerText() === '2 / 2 Running',
    'Two active batches fill the two slots');
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    const slotsFit = await page.locator('#batchSlots').evaluate(element => element.getBoundingClientRect().right <= innerWidth);
    check(slotsFit, 'Batch slots fit at ' + width + 'px');
  }
  if (process.env.HATCH_UI_SCREENSHOT_DIR) await page.locator('#batchSlots').screenshot({ path: path.join(process.env.HATCH_UI_SCREENSHOT_DIR, 'batch-two-slots.png') });
  await page.locator('#openBatchModal').click();
  await page.locator('#batchLabel').fill('THIRD-BATCH');
  await page.locator('#eggCount').fill('12');
  await page.locator('#laidDate').fill('2026-10-08');
  await page.locator('#startDate').fill('2026-10-10');
  await page.locator('#saveBatchBtn').click();
  await page.locator('#formStatus').filter({ hasText: 'Both batch slots are in use' }).waitFor();
  check(await page.locator('#batchTableBody tr[data-id]').count() === 2, 'A third active batch cannot be added when both slots are occupied');
  await page.locator('#batchStatus').selectOption('Paused');
  await page.locator('#saveBatchBtn').click();
  await page.locator('#modalConfirmBtn').click();
  await until(async () => await page.locator('#batchTableBody tr[data-id]').count() === 3);
  check(await page.locator('#slotCountBadge').innerText() === '2 / 2 Running', 'Non-active historical records do not consume a slot');
  await page.evaluate(() => HatchBatchStore.saveBatches([]));
  await page.reload();
  await until(async () => await page.locator('#batchSlots .batch-slot.empty').count() === 2);
  check(await page.locator('#batchTableBody tr[data-id]').count() === 0, 'Removing all records does not recreate defaults');
  check(errors.length === 0, 'Batch page has no JavaScript errors');
  await page.close();
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = http.createServer((request, response) => {
  const dataRoot = path.join(root, 'data');
  const file = path.resolve(dataRoot, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(dataRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end(); return;
  }
  response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(response);
});
(async () => {
  const network = fs.readFileSync(path.join(root, 'src/NetworkManager.cpp'), 'utf8');
  check(!/\b(?:delay|while)\s*\(/.test(network), 'Networking source has no delay or connection polling wait loop');
  const handler = network.slice(network.indexOf('String NetworkManager::connectToWifi'), network.indexOf('String NetworkManager::forgetWifi'));
  check(!handler.includes('WiFi.begin('), 'Connect HTTP path queues work without starting a station handshake');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    await wifiChecks(browser, origin);
    await dashboardChecks(browser, origin);
    await batchChecks(browser, origin);
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
