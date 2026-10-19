class HatchEspApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async request(path, options = {}) {
    const { timeoutMs, ...fetchOptions } = options;
    const controller = timeoutMs ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(this.baseUrl + path, {
        cache: "no-store",
        ...fetchOptions,
        ...(controller ? { signal: controller.signal } : {})
      });

      if (!response.ok) {
        throw new Error(`ESP32 request failed: ${response.status}`);
      }

      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  getData() {
    return this.request("/api/data", { timeoutMs: 10000 });
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
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(this.normalizePayload(payload)).toString()
    });
  }

  turnEggsNow() {
    return this.request("/api/turn", {
      method: "POST"
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
