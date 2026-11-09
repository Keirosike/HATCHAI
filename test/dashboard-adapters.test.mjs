import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const scope = { window: {} };
vm.runInNewContext(await readFile(new URL('../data/js/dashboardAdapters.js', import.meta.url), 'utf8'), scope);
const { local, online } = scope.window.HatchDashboardAdapters;
test('local adapter delegates data, prediction and controls without changing arguments', async () => {
  const calls = [];
  const api = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, args]); return Promise.resolve(name); } });
  const batches = {};
  const adapter = local(api, batches);
  assert.equal(adapter.batchStore, batches);
  assert.equal(adapter.pollMs, 5000);
  for (const name of ['getData', 'predictBatch', 'updateControl', 'turnEggsNow', 'stopEggs', 'safetyAction', 'syncBatch', 'request']) {
    assert.equal(await adapter[name]('one', 2), name);
    assert.deepEqual(calls.at(-1), [name, ['one', 2]]);
  }
});
test('online adapter authenticates, has no local store, and returns honest availability', async () => {
  let calls = 0;
  const adapter = online({ accessToken: () => 'synthetic-session', readIncubators: async token => {
    assert.equal(token, 'synthetic-session'); calls++; return [{ id: 'incubator' }];
  } });
  const data = await adapter.getData();
  assert.equal(calls, 1); assert.equal(data.incubators.length, 1);
  assert.equal(adapter.batchStore, null); assert.equal(data.lastSyncedAt, null);
  for (const feature of ['telemetry', 'history', 'batches', 'predictions', 'cameras']) assert.equal(data[feature].available, false);
  for (const method of ['getHistory', 'getBatches', 'getPredictions', 'getCameras']) assert.equal((await adapter[method]()).available, false);
});
test('online operations fail closed without performing another request', async () => {
  const adapter = online({ accessToken: () => assert.fail(), readIncubators: () => assert.fail() });
  for (const name of ['request', 'predictBatch', 'updateControl', 'turnEggsNow', 'stopEggs', 'safetyAction',
    'syncBatch', 'getWifiStatus', 'scanWifi', 'connectWifi', 'forgetWifi']) await assert.rejects(adapter[name](), /unavailable in online monitoring/);
});
test('initial data cannot bypass expired session and failures cannot return a stale success', async () => {
  const adapter = online({ accessToken: () => { throw new Error('Sign in again'); },
    initialIncubators: [{ id: 'old' }], readIncubators: () => assert.fail() });
  await assert.rejects(adapter.getData(), /Sign in again/);
  for (const reason of ['HTTP 401', 'network unavailable']) {
    const failed = online({ accessToken: () => 'synthetic', readIncubators: async () => { throw new Error(reason); } });
    await assert.rejects(failed.getData(), new RegExp(reason));
  }
});
test('initial authorized result is consumed once, missing records remain empty', async () => {
  let calls = 0;
  const adapter = online({ accessToken: () => 'synthetic', initialIncubators: [{ id: 'initial' }],
    readIncubators: async () => { calls++; return []; } });
  assert.equal((await adapter.getData()).incubators[0].id, 'initial');
  assert.equal((await adapter.getData()).incubators.length, 0); assert.equal(calls, 1);
});
