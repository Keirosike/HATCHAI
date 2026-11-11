// Shared browser contract. No environment detection and no network on import.
(function () {
  const unavailable = feature => Object.freeze({ available: false, reason: feature + ' is not connected yet.' });
  function local(api, batchStore) {
    if (!api || typeof api.getData !== 'function') throw new Error('Local API unavailable.');
    const adapter = { mode: 'local', batchStore, pollMs: 5000,
      capabilities: Object.freeze({ telemetry: true, batches: true, predictions: true, cameras: true, controls: true }) };
    for (const name of ['getData', 'predictBatch', 'getWifiStatus', 'scanWifi', 'connectWifi', 'forgetWifi',
      'updateControl', 'turnEggsNow', 'stopEggs', 'safetyAction', 'syncBatch', 'request']) {
      adapter[name] = (...args) => api[name](...args);
    }
    return Object.freeze(adapter);
  }
  function online({ readIncubators, accessToken, initialIncubators,readTelemetry,selectedIncubator }) {
    if (typeof readIncubators !== 'function' || typeof accessToken !== 'function') throw new Error('Online authentication unavailable.');
    let initial = initialIncubators,lastAccountRead=Date.now(),lastToken=null;
    const adapter = { mode: 'online', batchStore: null, pollMs: readTelemetry?2000:60000,
      capabilities: Object.freeze({ telemetry: false, batches: false, predictions: false, cameras: false, controls: false }),
      async getData() {
        // Check session expiry even when using the just-verified initial result.
        const token = accessToken();
        if(initial===undefined||(lastToken!==null&&lastToken!==token)||Date.now()-lastAccountRead>=60000){initial=await readIncubators(token);lastAccountRead=Date.now();}
        lastToken=token;const incubators=initial;if(!readTelemetry)initial=undefined;
        const id=selectedIncubator?.()||incubators[0]?.id;
        const synchronized=id&&readTelemetry?await readTelemetry(token,id):null;
        return { incubators, synchronized, telemetry: synchronized?{available:true}:unavailable('Telemetry'), history: unavailable('History'),
          batches: unavailable('Batches'), predictions: unavailable('Predictions'), cameras: unavailable('Camera history'),
          lastSyncedAt: synchronized?.latest?.receivedAt??null };
      },
      async getHistory() { return unavailable('History'); },
      async getBatches() { return unavailable('Batches'); },
      async getPredictions() { return unavailable('Predictions'); },
      async getCameras() { return unavailable('Camera history'); }
    };
    for (const name of ['request', 'predictBatch', 'updateControl', 'turnEggsNow', 'stopEggs', 'safetyAction',
      'syncBatch', 'getWifiStatus', 'scanWifi', 'connectWifi', 'forgetWifi']) {
      adapter[name] = async () => { throw new Error('This operation is unavailable in online monitoring.'); };
    }
    return Object.freeze(adapter);
  }
  window.HatchDashboardAdapters = Object.freeze({ local, online });
})();
