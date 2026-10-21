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
      } else if (url.pathname === '/api/data') {
        await route.fulfill({ json: { control: { temperatureOffset: 0 } } });
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
  const boundUpdates = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page, origin);
  await page.route('**/api/**', route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint === '/api/safety') boundUpdates.push(Object.fromEntries(new URLSearchParams(route.request().postData())));
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
  check(await page.locator('#targetTemp').inputValue() === '37.5°C' && await page.locator('#targetHumidity').inputValue() === '55%',
    'New batch form defaults to 37.5 C and 55 percent humidity');
  const normalizedDefaults = await page.evaluate(() => {
    const saved = HatchBatchStore.loadBatches();
    HatchBatchStore.saveBatches([{ id: 'default-target-fixture', count: 12, status: 'Paused' }]);
    const normalized = HatchBatchStore.loadBatches()[0];
    HatchBatchStore.saveBatches(saved);
    return normalized;
  });
  check(normalizedDefaults.targetTemp === '37.5°C' && normalizedDefaults.targetHumidity === '55%',
    'Missing batch targets receive new defaults without rewriting existing targets');
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

  boundUpdates.length=0;
  await page.locator('#openBatchModal').click();
  await page.locator('#batchLabel').fill('LOWER-FLOCK');
  await page.locator('#eggCount').fill('12');
  await page.locator('#laidDate').fill('2026-10-08');
  await page.locator('#startDate').fill('2026-10-10');
  await page.locator('#saveBatchBtn').click();
  check((await page.locator('#formStatus').innerText()).includes('Choose lower, upper, or both rollers'),
    'Active batches require an explicit roller choice');
  await page.locator('#batchRoller').selectOption('1');
  await page.locator('#saveBatchBtn').click();
  check((await page.locator('#modalMessage').innerText()).includes('lower roller'),'Batch confirmation names its selected roller');
  await page.locator('#modalCancelBtn').click();
  check(boundUpdates.length===0,'Cancelling batch placement sends no device write');
  await page.locator('#saveBatchBtn').click();await page.locator('#modalConfirmBtn').click();
  await until(()=>boundUpdates.length===1);
  check(boundUpdates[0].roller==='1' && boundUpdates[0].batchLabel==='LOWER-FLOCK','Saving the batch sends the lower roller and its real label');
  await until(async()=>!await page.locator('#batchModal').evaluate(el=>el.classList.contains('active')));
  await page.locator('#openBatchModal').click();
  await page.locator('#batchLabel').fill('UPPER-FLOCK');await page.locator('#eggCount').fill('10');
  await page.locator('#laidDate').fill('2026-10-08');await page.locator('#startDate').fill('2026-10-10');
  await page.locator('#batchRoller').selectOption('1');await page.locator('#saveBatchBtn').click();
  check((await page.locator('#formStatus').innerText()).includes('already has an active batch'),'Two active batches cannot choose the same roller');
  await page.locator('#batchRoller').selectOption('2');await page.locator('#saveBatchBtn').click();await page.locator('#modalConfirmBtn').click();
  await until(()=>boundUpdates.length===2);
  check(boundUpdates[1].roller==='2','Upper roller selection reaches the device API');
  await page.evaluate(()=>HatchBatchStore.saveBatches([]));await page.reload();
  boundUpdates.length=0;
  await page.locator('#openBatchModal').click();
  check(await page.locator('#startTime').inputValue()!=='','New batch detects its current start time automatically');
  await page.locator('#batchLabel').fill('SHARED-FLOCK');await page.locator('#eggCount').fill('24');
  await page.locator('#laidDate').fill('2026-10-08');await page.locator('#startDate').fill('2026-10-10');
  await page.locator('#startTime').fill('14:30:00');await page.locator('#startTime').dispatchEvent('change');
  await page.locator('#batchRoller').selectOption('3');
  check((await page.locator('#turningEnd').inputValue()).replace(/:00$/,'')==='2026-10-27T14:30',
    'Chicken turning defaults to the start of day 18 using the exact start time');
  await page.locator('#turningEnd').fill('2026-10-28T14:30');await page.locator('#saveBatchBtn').click();
  check((await page.locator('#formStatus').innerText()).includes('start of chicken day 18')&&boundUpdates.length===0,
    'A turning end beyond day 18 cannot reach the device');
  await page.locator('#turningEnd').fill('2026-10-26T13:15');await page.locator('#saveBatchBtn').click();
  check((await page.locator('#modalMessage').innerText()).includes('both rollers'),'Review names Both rollers before saving');
  await page.locator('#modalConfirmBtn').click();await until(()=>boundUpdates.length===1);
  check(boundUpdates[0].roller==='3'&&boundUpdates[0].turningEnd==='2026-10-26T13:15:00',
    'Both placement and an earlier turning end reach the firmware together');
  await until(async()=>!await page.locator('#batchModal').evaluate(el=>el.classList.contains('active')));
  check(await page.locator('#batchSlots .batch-slot.empty').count()===0,'Both reserves the two rollers without advertising an empty slot');
  await page.locator('#openBatchModal').click();await page.locator('#batchLabel').fill('CONFLICT');await page.locator('#eggCount').fill('10');
  await page.locator('#batchRoller').selectOption('2');await page.locator('#saveBatchBtn').click();
  check((await page.locator('#formStatus').innerText()).includes('already has an active batch'),'Both placement blocks another batch from taking either roller');
  await page.evaluate(()=>HatchBatchStore.saveBatches([]));await page.reload();
  await page.evaluate(record => localStorage.setItem('hatchai_batches', JSON.stringify([record])), own);
  await page.reload();
  boundUpdates.length = 0;
  await page.locator('#batchTableBody button[data-action="edit"]').click();
  await page.locator('#batchStatus').selectOption('Paused');
  await page.locator('#saveBatchBtn').click();
  await page.locator('#modalConfirmBtn').click();
  await until(() => boundUpdates.length === 1);
  check(boundUpdates[0].action === 'batchUpdate' && boundUpdates[0].batchId === own.id && boundUpdates[0].active === 'false',
    'Pausing a batch sends its inactive state to the device binding');
  check(boundUpdates[0].token === 'isolated-ui-test', 'Batch-device synchronization carries the active session token');
  await page.locator('#batchTableBody button[data-action="delete"]').click();
  await page.locator('#modalConfirmBtn').click();
  await until(async () => await page.locator('#batchTableBody tr[data-id]').count() === 0);
  check(boundUpdates.length === 2 && boundUpdates[1].active === 'false', 'Deleting a batch confirms its bound turning is disabled');
  check(errors.length === 0, 'Batch page has no JavaScript errors');
  await page.close();
}
async function controlChecks(browser,origin) {
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],writes=[];
  page.on('pageerror',error=>errors.push(error.message));
  const batches=[1,2].map(i=>({id:'physical-'+i,label:'FLOCK-'+i,name:'Chicken Batch '+i,roller:i,count:10,startDate:'2026-10-10',laidDate:'2026-10-09',status:'Active'}));
  await prepare(page,origin,{hatchai_batches:batches});
  const state={temperature:37.2,humidity:55,sensorValid:true,sensorAgeSeconds:0,wifiStatus:'Connected',rtcTime:'2026-10-20 12:00:00',clockStatus:'Ready',
    relayPins:{bulb:27,fan:14,turner:26,turner2:25},recovery:{version:1,ready:true,logging:true,sdAvailable:true,sequence:4},
    control:{autoMode:true,bulbOn:false,manualBulbOn:false,fanOn:true,manualFanOn:true,turnerOn:false,turner2On:false,
      turnDurationSeconds:15,turnDuration2Seconds:15,turnIntervalMinutes:120,turnInterval2Minutes:120,targetTemperature:37.5,targetHumidity:55,
      heaterControl:'thermostat_hysteresis',heaterOnBelow:37.2,heaterOffAbove:37.8},
    safety:{version:2,sensorReady:true,watchdogReady:true,storageReady:true,rtcTrusted:true,critical:false,message:'Temperature checks passed.',
      batches:batches.map((b,i)=>({motor:i+1,batchId:b.id,label:b.label,active:true,canRun:true,canManualRun:true,status:'Manual ready'}))}};
  let active=0,maxActive=0;
  await page.route('**/api/**',async route=>{
    const endpoint=new URL(route.request().url()).pathname;
    if(endpoint.startsWith('/api/session/'))return route.fulfill({json:{ok:true,active:true}});
    active++;maxActive=Math.max(maxActive,active);
    try {
      const body=Object.fromEntries(new URLSearchParams(route.request().postData()||''));
      if(endpoint==='/api/control') {
        writes.push({kind:'settings',...body});
        if(body.autoMode!==undefined)state.control.autoMode=body.autoMode==='true';
        if(body.bulbOn!==undefined)state.control.manualBulbOn=body.bulbOn==='true';
        if(body.fanOn!==undefined)state.control.manualFanOn=body.fanOn==='true';
        for(const key of ['turnDurationSeconds','turnDuration2Seconds','turnIntervalMinutes','turnInterval2Minutes'])if(body[key]!==undefined)state.control[key]=Number(body[key]);
        state.control.bulbOn=state.control.manualBulbOn&&!state.safety.critical&&state.safety.sensorReady;
        state.control.fanOn=state.control.autoMode||state.control.manualFanOn||state.control.bulbOn||state.safety.critical||!state.safety.sensorReady;
      } else if(endpoint==='/api/turn') {
        writes.push({kind:'turn',...body});
        if(body.action!=='stop'&&(state.safety.critical||!state.safety.sensorReady))return await route.fulfill({status:409,json:{message:'Motor held OFF: sensor or temperature protection.'}});
        const second=body.motor==='2',key=second?'turner2On':'turnerOn',pulse=second?'turnPulse2Active':'turnPulseActive',queue=second?'turn2Queued':'turnQueued';
        if(body.action==='stop')state.control[key]=state.control[pulse]=state.control[queue]=false;
        else if(state.control[second?'turnerOn':'turner2On'])state.control[queue]=true;
        else state.control[key]=state.control[pulse]=true;
      } else if(endpoint!=='/api/data')throw new Error('Unexpected control endpoint '+endpoint);
      check(!(state.control.turnerOn&&state.control.turner2On),'Mock control never runs motors together');
      await route.fulfill({json:state});
    } finally {active--;}
  });
  const settled=()=>page.waitForFunction(()=>!HatchControl.isSyncing&&!HatchControl.isLoading);
  await page.goto(origin+'/control.html');await settled();
  check(await page.locator('#safetyTitle').count()===0&&await page.locator('#setClockBtn').count()===0,'Control removes setup/scheduled-turning panel and clock button');
  check(await page.locator('#turnBatch1').count()===0&&(await page.locator('#turnerTitle').innerText()).includes('FLOCK-1'),'Control uses the saved batch label without assignment dropdowns');
  check(await page.locator('#bulbSwitch').isEnabled()&&await page.locator('#fanSwitch').isEnabled(),'Bulb and fan sliders accept direct requests in automatic mode');
  check(await page.locator('#bulbSwitch').evaluate(el=>el.getBoundingClientRect().width>=44),'Slider checkbox has a real pointer hit target');
  await page.locator('#bulbSwitch').check();await settled();
  check(!state.control.autoMode&&state.control.bulbOn,'A bulb request switches to manual mode and updates the commanded relay');
  await page.locator('#bulbSwitch').uncheck();await settled();
  await page.locator('#fanSwitch').uncheck();await settled();
  check(!state.control.fanOn,'Manual fan OFF is supported while heat is OFF and readings are safe');
  await page.locator('#bulbSwitch').check();await settled();
  check(state.control.fanOn&&(await page.locator('#fanText').innerText()).includes('protection'),'Fan override remains visible during heating');
  await page.locator('#bulbSwitch').uncheck();await settled();
  state.recovery.ready=false;state.recovery.logging=false;state.recovery.checkpointFault=true;
  await page.evaluate(()=>HatchControl.loadControllerState());
  await page.locator('#turnerSwitch').check();await settled();
  check(state.control.turnerOn&&writes.at(-1).manual==='true','Motor slider sends an explicit timed manual request during an SD fault');
  check(await page.locator('#turnerSwitch').isEnabled(),'Active motor slider stays usable for OFF');
  await page.locator('#turnerSwitch').uncheck();await settled();
  check(writes.at(-1).action==='stop'&&!state.control.turnerOn,'Motor slider OFF sends stop');
  await page.locator('#turnDuration2').fill('7');await page.locator('#turnEgg2Btn').click();await page.locator('#modalConfirmBtn').click();await settled();
  check(state.control.turner2On&&writes.at(-1).durationSeconds==='7','Upper roller Run uses its entered timed duration');
  await page.locator('#stopEgg2Btn').click();await settled();
  state.safety.critical=true;state.safety.message='Critical temperature: heater and motors held OFF.';
  await page.evaluate(()=>HatchControl.loadControllerState());
  await page.locator('#turnEggBtn').click();await page.locator('#modalConfirmBtn').click();await settled();
  check(!state.control.turnerOn&&(await page.locator('#settingsStatus').innerText()).includes('held OFF'),'Rejected motor request explains protection instead of appearing to run');
  state.safety.critical=false;state.recovery.ready=true;state.recovery.logging=true;state.recovery.checkpointFault=false;
  await page.evaluate(()=>HatchControl.loadControllerState());
  await page.locator('#turnDuration1').fill('9');await page.locator('#turnInterval').selectOption('60');
  const before=writes.length;await page.locator('#saveControlSettingsBtn').click();
  check(writes.length===before&&(await page.locator('#modalDetails').innerText()).includes('9 sec every 60 min'),'Save opens a concrete timing review without writing');
  await page.locator('#modalCancelBtn').click();check(writes.length===before,'Cancel sends no settings write');
  await page.locator('#saveControlSettingsBtn').click();await page.locator('#turnDuration1').evaluate(el=>el.value='99');await page.locator('#modalConfirmBtn').click();await settled();
  check(state.control.turnDurationSeconds===9,'Save sends the reviewed snapshot rather than subsequent form edits');
  await page.locator('#autoModeSwitch').check();await settled();
  check((await page.locator('#bulbText').innerText()).includes('37.2')&&(await page.locator('#bulbText').innerText()).includes('37.8'),'Thermostat ON/OFF limits remain visible');
  check(!(await page.locator('main').innerText()).includes('PID'),'Control no longer advertises PID');
  state.safety.batches[0].label='LONG-FLOCK-LABEL-012345678901234';await page.evaluate(()=>HatchControl.loadControllerState());
  for(const width of [375,812,1280]) {
    await page.setViewportSize({width,height:900});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Control fits at '+width+'px');
    if(width===375&&process.env.HATCH_UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.HATCH_UI_SCREENSHOT_DIR,'control-compact-phone.png'),fullPage:true,animations:'disabled'});
  }
  state.relayPins.bulb=26;await page.evaluate(()=>HatchControl.loadControllerState());
  check(await page.locator('#bulbSwitch').isDisabled(),'Incompatible relay firmware remains blocked');
  check(maxActive===1,'Control requests stay serialized');check(errors.length===0,'Control has no browser JavaScript errors');await page.close();
}
async function calibrationChecks(browser, origin) {
  const page=await browser.newPage({viewport:{width:812,height:1000}});
  const errors=[],updates=[];let offset=0.3,reject=false;
  page.on('pageerror',e=>errors.push(e.message));
  await prepare(page,origin);
  await page.route('**/api/**',async route=>{
    const endpoint=new URL(route.request().url()).pathname;
    if(endpoint==='/api/control'){
      const body=Object.fromEntries(new URLSearchParams(route.request().postData()));
      updates.push(body);
      if(reject)return route.fulfill({status:409,json:{message:'Storage fault'}});
      offset=Number(body.temperatureOffset);
    }
    return route.fulfill({json:endpoint==='/api/data'||endpoint==='/api/control'?
      {control:{temperatureOffset:offset}}:endpoint==='/api/wifi/status'?
      {connected:false,connecting:false,apSsid:'HatchAI-ESP32',apIpAddress:'192.168.4.1'}:{ok:true,active:true}});
  });
  await page.route('**/scan-wifi*',route=>route.fulfill({json:[]}));
  await page.goto(origin+'/settings.html');
  await until(async()=>await page.locator('#temperatureOffset').inputValue()==='0.3');
  check(true,'Settings loads the applied temperature offset from ESP32');
  await page.locator('#temperatureOffset').fill('2.1');
  await page.locator('#saveSettingsBtn').click();await page.locator('#modalConfirmBtn').click();
  await until(async()=>(await page.locator('#saveStatus').innerText()).includes('between -2'));
  check(updates.length===0,'Invalid calibration cannot reach the device');
  await page.locator('#temperatureOffset').fill('-0.2');
  await page.locator('#saveSettingsBtn').click();await page.locator('#modalConfirmBtn').click();
  await until(async()=>(await page.locator('#saveStatus').innerText()).includes('successfully'));
  check(updates[0].temperatureOffset==='-0.2','Temperature calibration uses the firmware control endpoint');
  check(JSON.parse(await page.evaluate(()=>localStorage.getItem('hatchaiSettings'))).temperatureOffset==='-0.2',
    'Browser calibration is saved after device acknowledgment');
  await page.locator('#resetSettingsBtn').click();await page.locator('#modalConfirmBtn').click();
  await until(()=>updates.length===2);
  check(updates[1].temperatureOffset==='0','Reset applies zero temperature offset to the device');
  reject=true;await page.locator('#temperatureOffset').fill('0.4');
  await page.locator('#saveSettingsBtn').click();await page.locator('#modalConfirmBtn').click();
  await until(async()=>(await page.locator('#saveStatus').innerText()).includes('not applied'));
  check(await page.evaluate(()=>localStorage.getItem('hatchaiSettings'))===null,'Rejected calibration is not represented as saved');
  check(errors.length===0,'Calibration flow has no browser JavaScript errors');
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
    if (!process.env.HATCH_CONTROL_ONLY) {
      await wifiChecks(browser, origin);
      await dashboardChecks(browser, origin);
      await batchChecks(browser, origin);
    }
    await controlChecks(browser, origin);
    if (!process.env.HATCH_CONTROL_ONLY) await calibrationChecks(browser, origin);
    console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
