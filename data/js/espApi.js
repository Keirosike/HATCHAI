class HatchEspApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async request(path, options = {}) {
    const response = await fetch(this.baseUrl + path, {
      cache: "no-store",
      ...options
    });

    if (!response.ok) {
      throw new Error(`ESP32 request failed: ${response.status}`);
    }

    return response.json();
  }

  getData() {
    return this.request("/api/data");
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
