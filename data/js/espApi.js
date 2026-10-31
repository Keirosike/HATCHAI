class HatchEspApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  request(path, options = {}) {
    const previous = HatchEspApiClient.requestQueue || Promise.resolve();
    const task = previous.catch(() => {}).then(() => this.performRequest(path, options));
    HatchEspApiClient.requestQueue = task;
    return task;
  }

  async performRequest(path, options = {}) {
    const { timeoutMs, ...fetchOptions } = options;
    const controller = timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(this.baseUrl + path, {
        cache: "no-store",
        ...fetchOptions,
        ...(controller ? { signal: controller.signal } : {})
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `ESP32 request failed: ${response.status}`);
      return data;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async getData() {
    let data = await this.request("/api/data", { timeoutMs: 10000 });
    const token=window.HatchStorage?.get("hatchaiActiveSession",null)?.token;
    if(data.clockSyncNeeded && token && (!this.clockAttempt || Date.now()-this.clockAttempt>=30000)) {
      this.clockAttempt=Date.now();
      const d=new Date(), pad=n=>String(n).padStart(2,"0");
      try { data=await this.safetyAction("clockAuto",{dateTime:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`}); }
      catch(error) { data.clockSyncError=error.message; }
    }
    window.HatchBatchStore?.importDeviceBatches?.(data);
    return data;
  }

  getWifiStatus() {
    return this.request("/api/wifi/status", { timeoutMs: 6000 });
  }

  scanWifi() {
    return this.request("/scan-wifi", { timeoutMs: 6000 });
  }

  connectWifi(ssid, password, useSaved = false) {
    return this.request("/api/wifi/connect", {
      method: "POST",
      timeoutMs: 6000,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ssid, password, useSaved }).toString()
    });
  }

  forgetWifi() {
    return this.request("/api/wifi/forget", { method: "POST", timeoutMs: 6000 });
  }

  updateControl(payload) {
    return this.request("/api/control", {
      method: "POST",
      timeoutMs: 10000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(this.normalizePayload(payload)).toString()
    });
  }

  turnEggsNow(motor = "both", durationSeconds) {
    const payload = { motor: String(motor), manual: true };
    if (durationSeconds !== undefined) payload.durationSeconds = String(durationSeconds);
    return this.request("/api/turn", {
      method: "POST",
      timeoutMs: 10000,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload).toString()
    });
  }

  stopEggs(motor = "both") {
    return this.request("/api/turn", {
      method: "POST",
      timeoutMs: 10000,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ motor: String(motor), action: "stop" }).toString()
    });
  }

  predictBatch(payload) {
    return this.request("/api/predict", {
      method: "POST",
      timeoutMs: 10000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(this.normalizePayload(payload)).toString()
    });
  }

  safetyAction(action, payload = {}) {
    const token = window.HatchStorage?.get("hatchaiActiveSession", null)?.token || "";
    return this.request("/api/safety", {
      method: "POST", timeoutMs: 10000,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(this.normalizePayload({ ...payload, action, token })).toString()
    });
  }

  syncBatch(batch, active = batch.status === "Active") {
    return this.safetyAction("batchUpdate", { ...this.batchPayload(batch, active),
      ...(active && [1,2,3].includes(Number(batch.roller)) ? { roller: Number(batch.roller) } : {}) });
  }

  batchPayload(batch, active = batch.status === "Active") {
    return { batchId: batch.id || "", startDate: batch.startDate || "",
      startTime: batch.startTime || "00:00:00", durationDays: batch.durationDays || 21,
      turningEnd: batch.turningEnd || "",
      active, batchStatus: !batch.id ? "" : active ? "Active" :
        ["Completed", "Failed"].includes(batch.status) ? batch.status : "Paused",
      batchLabel: batch.label || "", batchName: batch.name || "", eggCount: batch.count || 0 };
  }

  normalizePayload(payload) {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        typeof value === "boolean" ? String(value) : value
      ])
    );
  }
}

window.HatchEspApi = new HatchEspApiClient(window.HATCH_ESP32_BASE_URL || "");
