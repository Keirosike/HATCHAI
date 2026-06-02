const WIFI_KEY = "hatchaiWifi";

function getWifiElements() {
  return {
    wifiStatus: document.getElementById("wifiStatus"),
    wifiNetworkList: document.getElementById("wifiNetworkList"),
    scanWifiBtn: document.getElementById("scanWifiBtn"),
    connectWifiBtn: document.getElementById("connectWifiBtn"),
    forgetWifiBtn: document.getElementById("forgetWifiBtn"),
    wifiSsid: document.getElementById("wifiSsid"),
    wifiPassword: document.getElementById("wifiPassword"),
    toggleWifiPassword: document.getElementById("toggleWifiPassword"),
    wifiCardStatus: document.getElementById("wifiCardStatus"),
    espWifiBadge: document.getElementById("espWifiBadge"),
    espIpAddress: document.getElementById("espIpAddress"),
    espSignal: document.getElementById("espSignal")
  };
}

function getEsp32Urls(preferredBaseUrl = "") {
  return [
    "",
    preferredBaseUrl,
    window.location.protocol.startsWith("http") ? window.location.origin : "",
    "http://hatchai.local",
    "http://192.168.4.1"
  ].filter(Boolean);
}

function setEspWifiState(label, statusClass, ip, signal) {
  const {
    wifiStatus,
    espWifiBadge,
    espIpAddress,
    espSignal
  } = getWifiElements();

  if (!espWifiBadge || !espIpAddress || !espSignal) return;

  espWifiBadge.textContent = label;
  espWifiBadge.className = "status-pill " + statusClass;
  espIpAddress.textContent = ip;
  espSignal.textContent = signal;

  if (wifiStatus) {
    wifiStatus.textContent =
      label === "Connected" || label === "Selected" ? "Online" : "Offline";
  }
}

function setWifiStatus(setStatus, message, color) {
  const { wifiCardStatus } = getWifiElements();

  if (wifiCardStatus) {
    wifiCardStatus.textContent = message;

    if (color) {
      wifiCardStatus.style.color = color;
      wifiCardStatus.style.borderColor = color;
    }

    return;
  }

  if (typeof setStatus === "function") {
    setStatus(message, color);
  }
}

async function scanWifiNetworks(setStatus) {
  const { wifiNetworkList } = getWifiElements();

  if (!wifiNetworkList) return;

  wifiNetworkList.innerHTML = "<li>Scanning Wi-Fi networks...</li>";
  setWifiStatus(setStatus, "Scanning Wi-Fi networks from ESP32...", "#D97706");

  for (const baseUrl of getEsp32Urls()) {
    try {
      const networks = await fetchWifiScanResults(baseUrl, setStatus);

      if (!Array.isArray(networks) || networks.length === 0) {
        wifiNetworkList.innerHTML = "<li>No Wi-Fi networks found.</li>";
        setWifiStatus(setStatus, "No Wi-Fi networks found.", "#2563EB");
        return;
      }

      renderWifiNetworks(networks, baseUrl, setStatus);
      setWifiStatus(setStatus, "Wi-Fi scan complete. Select a network from the list.", "#16A34A");
      return;
    } catch (error) {
      continue;
    }
  }

  wifiNetworkList.innerHTML =
    "<li>Cannot scan. Make sure the ESP32 server is running at hatchai.local or 192.168.4.1.</li>";
  setWifiStatus(setStatus, "Wi-Fi scan failed. Check ESP32 setup mode and /scan-wifi endpoint.", "#DC2626");
}

async function fetchWifiScanResults(baseUrl, setStatus) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch(baseUrl + "/scan-wifi?ts=" + Date.now(), {
      cache: "no-store",
      headers: {
        "Accept": "application/json"
      }
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error("Scan request failed: " + response.status + " " + text);
    }

    const payload = JSON.parse(text);

    if (Array.isArray(payload)) {
      return payload;
    }

    if (payload && payload.scanning) {
      setWifiStatus(setStatus, "ESP32 is scanning Wi-Fi networks...", "#D97706");
      await delay(900);
      continue;
    }

    throw new Error(payload?.message || "Unexpected Wi-Fi scan response");
  }

  throw new Error("Wi-Fi scan timed out");
}

function delay(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function renderWifiNetworks(networks, baseUrl, setStatus) {
  const { wifiNetworkList } = getWifiElements();

  if (!wifiNetworkList) return;

  wifiNetworkList.innerHTML = networks.map((network, index) => {
    const ssid = network.ssid || "Hidden Network";
    const lock = network.secure ? "Locked" : "Open";
    const rssi = network.rssi !== undefined ? network.rssi + " dBm" : "Signal unknown";

    return `
      <li>
        <button type="button" data-index="${index}">
          <span>${ssid} &middot; ${lock}</span>
          <span>${rssi}</span>
        </button>
      </li>
    `;
  }).join("");

  document.querySelectorAll("#wifiNetworkList button").forEach((button, index) => {
    button.addEventListener("click", () => {
      selectWifiNetwork(networks[index], button, baseUrl, setStatus);
    });
  });
}

function selectWifiNetwork(network, button, baseUrl, setStatus) {
  const { wifiSsid, wifiPassword } = getWifiElements();
  const ssid = network.ssid || "Hidden Network";
  const signal = network.rssi !== undefined ? network.rssi + " dBm" : "Signal unknown";
  const server = baseUrl.replace("http://", "");
  const savedWifi = loadData(WIFI_KEY, {});

  document.querySelectorAll("#wifiNetworkList button").forEach(item => {
    item.classList.remove("selected");
  });

  button.classList.add("selected");

  if (wifiSsid) {
    wifiSsid.value = ssid;
  }

  if (wifiPassword && savedWifi.ssid === ssid && savedWifi.password) {
    wifiPassword.value = savedWifi.password;
  }

  setEspWifiState("Selected", "status-warning", server, signal);

  saveData(WIFI_KEY, {
    ...savedWifi,
    ssid,
    signal,
    server,
    baseUrl,
    selected: true,
    connected: false
  });

  setWifiStatus(setStatus, "Selected Wi-Fi network: " + ssid + ".", "#2563EB");
}

async function connectSelectedWifi(setStatus) {
  const { wifiSsid, wifiPassword } = getWifiElements();
  const ssid = wifiSsid?.value.trim() || "";
  const password = wifiPassword?.value || "";

  if (!ssid) {
    setWifiStatus(setStatus, "Please select or enter a Wi-Fi SSID.", "#DC2626");
    return false;
  }

  const savedWifi = loadData(WIFI_KEY, {});
  setWifiStatus(setStatus, "Connecting ESP32 to " + ssid + "...", "#D97706");

  for (const baseUrl of getEsp32Urls(savedWifi.baseUrl)) {
    try {
      const response = await fetch(baseUrl + "/api/wifi/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({ ssid, password }).toString()
      });
      const result = await response.json();

      if (!result.connected) {
        continue;
      }

      const server = result.ipAddress || baseUrl.replace("http://", "");

      setEspWifiState("Connected", "status-ok", server, savedWifi.signal || "Connected");
      saveData(WIFI_KEY, {
        ssid,
        password,
        signal: savedWifi.signal || "Connected",
        server,
        baseUrl,
        selected: true,
        connected: true
      });

      setWifiStatus(setStatus, "ESP32 connected to " + ssid + ".", "#16A34A");
      return true;
    } catch (error) {
      continue;
    }
  }

  setEspWifiState("Connection Failed", "status-alert", "---", "---");
  setWifiStatus(setStatus, "ESP32 Wi-Fi connection failed. Check SSID and password.", "#DC2626");
  return false;
}

function loadSavedWifi() {
  const savedWifi = loadData(WIFI_KEY);

  if (!savedWifi || !savedWifi.selected) {
    return;
  }

  const { wifiSsid, wifiPassword } = getWifiElements();

  if (wifiSsid) {
    wifiSsid.value = savedWifi.ssid || "";
  }

  if (wifiPassword) {
    wifiPassword.value = savedWifi.password || "";
  }

  setEspWifiState(
    savedWifi.connected ? "Connected" : "Selected",
    savedWifi.connected ? "status-ok" : "status-warning",
    savedWifi.server || "hatchai.local",
    savedWifi.signal || "Signal unknown"
  );
}

function saveWifiStatus() {
  const { wifiSsid, wifiPassword } = getWifiElements();
  const savedWifi = loadData(WIFI_KEY, {});

  saveData(WIFI_KEY, {
    ...savedWifi,
    ssid: wifiSsid?.value.trim() || savedWifi.ssid || "",
    password: wifiPassword?.value || savedWifi.password || "",
    selected: Boolean(wifiSsid?.value.trim() || savedWifi.selected)
  });
}

async function forgetWifiOnEsp32() {
  const savedWifi = loadData(WIFI_KEY, {});

  for (const baseUrl of getEsp32Urls(savedWifi.baseUrl)) {
    try {
      await fetch(baseUrl + "/api/wifi/forget", {
        method: "POST",
        cache: "no-store"
      });
      return;
    } catch (error) {
      continue;
    }
  }
}

function resetWifiState(message = "Saved Wi-Fi was forgotten.") {
  const { wifiNetworkList, wifiSsid, wifiPassword } = getWifiElements();

  if (wifiNetworkList) {
    wifiNetworkList.innerHTML =
      "<li>No scan yet. Connect to the ESP32 setup Wi-Fi first, then click Scan Wi-Fi.</li>";
  }

  if (wifiSsid) {
    wifiSsid.value = "";
  }

  if (wifiPassword) {
    wifiPassword.value = "";
  }

  setWifiPasswordVisible(false);
  setWifiStatus(null, message, "#2563EB");
  setEspWifiState("Disconnected", "status-alert", "---", "---");
  removeData(WIFI_KEY);
}

async function forgetWifi() {
  setWifiStatus(null, "Forgetting saved Wi-Fi credentials...", "#D97706");
  await forgetWifiOnEsp32();
  resetWifiState("Saved Wi-Fi credentials removed.");
}

function setWifiPasswordVisible(isVisible) {
  const { wifiPassword, toggleWifiPassword } = getWifiElements();

  if (!wifiPassword || !toggleWifiPassword) return;

  wifiPassword.type = isVisible ? "text" : "password";
  toggleWifiPassword.textContent = isVisible ? "Hide" : "Show";
  toggleWifiPassword.setAttribute("aria-pressed", isVisible ? "true" : "false");
}

function toggleWifiPasswordVisibility() {
  const { wifiPassword } = getWifiElements();

  if (!wifiPassword) return;

  setWifiPasswordVisible(wifiPassword.type !== "text");
}

function statusSetter(message, color) {
  setWifiStatus(null, message, color);
}

document.addEventListener("DOMContentLoaded", () => {
  const {
    scanWifiBtn,
    connectWifiBtn,
    forgetWifiBtn,
    toggleWifiPassword
  } = getWifiElements();

  scanWifiBtn?.addEventListener("click", () => {
    scanWifiNetworks(statusSetter);
  });

  connectWifiBtn?.addEventListener("click", () => {
    connectSelectedWifi(statusSetter);
  });

  forgetWifiBtn?.addEventListener("click", () => {
    forgetWifi();
  });

  toggleWifiPassword?.addEventListener("click", () => {
    toggleWifiPasswordVisibility();
  });

  loadSavedWifi();
});

window.HatchWifi = {
  scanWifiNetworks,
  connectSelectedWifi,
  setEspWifiState,
  saveWifiStatus,
  loadSavedWifi,
  resetWifiState,
  forgetWifi
};
