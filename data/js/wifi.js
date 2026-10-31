const WIFI_KEY = "hatchaiWifi";
let wifiClient = null;
let wifiDeviceState = null;
let wifiNetworks = [];
let wifiBusy = false;
let wifiStatusTimer = null;
let wifiWaitingForSetup = false;
let wifiPendingSsid = "";
let wifiSelectedNetwork = null;
let wifiInitialScanPending = true;

function wifiElement(id) {
  return document.getElementById(id);
}

function wifiText(id, value) {
  const element = wifiElement(id);
  if (element && element.textContent !== value) element.textContent = value;
}

function setWifiStatus(message, isError = false) {
  wifiText("wifiCardStatus", message);
  const element = wifiElement("wifiCardStatus");
  if (element) element.style.color = isError ? "#B91C1C" : "";
}

function getEsp32Urls() {
  const saved = loadData(WIFI_KEY, {});
  return [...new Set([
    wifiClient?.baseUrl,
    window.HATCH_ESP32_BASE_URL,
    saved.baseUrl,
    window.location.protocol.startsWith("http") ? window.location.origin : "",
    "http://hatchai.local",
    "http://192.168.4.1"
  ].filter(Boolean))];
}

function signalText(rssi) {
  if (!Number.isFinite(rssi)) return "---";
  const quality = rssi >= -60 ? "Strong" : rssi >= -75 ? "Fair" : "Weak";
  return quality + " (" + rssi + " dBm)";
}

function setWifiBusy(busy) {
  wifiBusy = busy;
  for (const id of ["scanWifiBtn", "connectWifiBtn", "refreshWifiBtn", "forgetWifiBtn"]) {
    const element = wifiElement(id);
    if (element) element.disabled = busy ||
      ((id === "scanWifiBtn" || id === "connectWifiBtn") && wifiDeviceState?.connecting) ||
      (id === "forgetWifiBtn" && (!wifiDeviceState || !(wifiDeviceState.savedSsid || wifiDeviceState.connected)));
  }
  document.querySelectorAll("#wifiNetworkList button").forEach(button => {
    button.disabled = busy || Boolean(wifiDeviceState?.connecting);
  });
}

function applyWifiStatus(state) {
  const previous = wifiDeviceState;
  const changedNetwork = state.connected !== wifiDeviceState?.connected ||
    state.ssid !== wifiDeviceState?.ssid || state.savedSsid !== wifiDeviceState?.savedSsid;
  wifiDeviceState = state;
  const failed = state.connectionState === "failed";
  const label = state.connecting ? "Connecting" : state.connected ? "Connected" : failed ?
    (state.error === "network_unavailable" ? "Network unavailable" : "Connection failed") :
    state.apSsid ? "Setup mode" : "Disconnected";
  wifiText("wifiConnectionLabel", state.connected ? "Connected Wi-Fi on ESP32" : "ESP32 connection");
  wifiText("espConnectedSsid", state.connecting ? state.requestedSsid :
    state.connected ? state.ssid : state.apSsid || "No Wi-Fi connection");
  wifiText("espWifiBadge", label);
  const badge = wifiElement("espWifiBadge");
  if (badge) badge.className = "status-pill " + (state.connecting ? "status-warning" :
    state.connected ? "status-ok" : failed ? "status-alert" : "status-warning");
  wifiText("wifiStatus", state.connecting ? "Connecting" : state.connected ? "Online" : label);
  wifiText("wifiDetailSsid", state.connected ? state.ssid : "Not connected to a router");
  wifiText("wifiSavedSsid", state.savedSsid || "None");
  wifiText("espIpAddress", state.ipAddress || "---");
  wifiText("espSignal", state.connected ? signalText(state.rssi) : "---");
  wifiText("wifiSetupSsid", state.apSsid || "Not active");
  wifiText("wifiSetupIp", state.apIpAddress || "---");
  if (changedNetwork && wifiNetworks.length) renderWifiNetworks();
  if (state.connecting) {
    if (!previous?.connecting || previous.requestedSsid !== state.requestedSsid) {
      setWifiStatus("Connecting ESP32 to " + state.requestedSsid + "...");
    }
  } else if (failed) {
    wifiPendingSsid = "";
    setWifiStatus(state.error === "network_unavailable" ?
      "Network unavailable. Check that the network is nearby and uses 2.4 GHz." :
      "Incorrect password or connection failed. Check the password and try again.", true);
  } else if (state.connected && state.ssid === wifiPendingSsid) {
    wifiPendingSsid = "";
    saveData(WIFI_KEY, { ssid: state.ssid, baseUrl: wifiClient.baseUrl });
    setWifiStatus(state.credentialsSaved === false ?
      "Connected to " + state.ssid + ", but credentials could not be saved. Reconnect after a restart." :
      "Connected to " + state.ssid + ". Credentials saved on the ESP32.", state.credentialsSaved === false);
  } else if (!previous || changedNetwork) {
    setWifiStatus(state.connected ? "ESP32 connected to " + state.ssid + "." :
      "Tap a network below to connect.");
  }
}

function markWifiUnavailable() {
  wifiDeviceState = null;
  wifiText("espConnectedSsid", "ESP32 unavailable");
  wifiText("espWifiBadge", "Not verified");
  const badge = wifiElement("espWifiBadge");
  if (badge) badge.className = "status-pill status-alert";
  wifiText("wifiStatus", "Unavailable");
  for (const id of ["wifiDetailSsid", "wifiSavedSsid", "espIpAddress", "espSignal", "wifiSetupSsid", "wifiSetupIp"]) {
    wifiText(id, "---");
  }
  if (wifiNetworks.length) renderWifiNetworks();
}

async function refreshWifiStatus() {
  for (const baseUrl of getEsp32Urls()) {
    try {
      const client = new HatchEspApiClient(baseUrl);
      const state = await client.getWifiStatus();
      if (typeof state.connected !== "boolean" || typeof state.ssid !== "string") {
        throw new Error("Invalid Wi-Fi status response");
      }
      wifiClient = client;
      applyWifiStatus(state);
      return state;
    } catch (error) {
      // Only read requests use alternate addresses. Never repeat a connect or forget POST.
    }
  }
  throw new Error("Cannot read ESP32 Wi-Fi status. Check the connection and install the updated firmware.");
}

function scheduleWifiStatus() {
  clearTimeout(wifiStatusTimer);
  if (!document.hidden && !wifiWaitingForSetup) {
    wifiStatusTimer = setTimeout(() => runWifiTask(async () => {
      const state = await refreshWifiStatus();
      if (!state.connecting && wifiInitialScanPending) await scanWifiNetworks(false);
    }, false), 5000);
  }
}

async function runWifiTask(action, interactive = true) {
  if (wifiBusy) return;
  clearTimeout(wifiStatusTimer);
  wifiBusy = true;
  if (interactive) setWifiBusy(true);
  try {
    await action();
  } catch (error) {
    markWifiUnavailable();
    setWifiStatus(error.message || "Wi-Fi request failed.", true);
    if (wifiElement("wifiJoinDialog")?.open) wifiText("wifiJoinError", error.message || "Connection failed.");
  } finally {
    setWifiBusy(false);
    scheduleWifiStatus();
  }
}

function showWifiListMessage(message) {
  const list = wifiElement("wifiNetworkList");
  if (!list) return;
  const item = document.createElement("li");
  item.textContent = message;
  list.replaceChildren(item);
}

function renderWifiNetworks() {
  const list = wifiElement("wifiNetworkList");
  if (!list) return;
  list.replaceChildren();
  const selectedSsid = wifiSelectedNetwork?.ssid || "";
  const networks = wifiNetworks.slice().sort((a, b) =>
    Number(b.ssid === wifiDeviceState?.ssid) - Number(a.ssid === wifiDeviceState?.ssid) || b.rssi - a.rssi);
  for (const network of networks) {
    const connected = Boolean(wifiDeviceState?.connected && network.ssid === wifiDeviceState.ssid);
    const saved = Boolean(network.ssid && network.ssid === wifiDeviceState?.savedSsid);
    const item = document.createElement("li");
    const button = document.createElement("button");
    const name = document.createElement("span");
    const detail = document.createElement("span");
    button.type = "button";
    button.disabled = wifiBusy || Boolean(wifiDeviceState?.connecting);
    button.classList.toggle("selected", Boolean(network.ssid && network.ssid === selectedSsid));
    button.setAttribute("aria-pressed", String(Boolean(network.ssid && network.ssid === selectedSsid)));
    name.textContent = (network.ssid || "Hidden network") + (connected ? " · Connected" : saved ? " · Saved" : "");
    if (network.secure) {
      const lock = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      lock.setAttribute("viewBox", "0 0 24 24");
      lock.setAttribute("class", "wifi-lock");
      lock.setAttribute("fill", "none");
      lock.setAttribute("stroke", "currentColor");
      lock.setAttribute("stroke-width", "2");
      lock.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z");
      lock.append(path);
      detail.append(lock);
    }
    detail.append(document.createTextNode((network.secure ? "Secured" : "Open") + " · " + signalText(network.rssi)));
    button.append(name, detail);
    button.addEventListener("click", () => selectWifiNetwork(network));
    item.append(button);
    list.append(item);
  }
}

function selectWifiNetwork(network) {
  if (wifiBusy || wifiDeviceState?.connecting || !network.ssid) return;
  if (wifiDeviceState?.connected && network.ssid === wifiDeviceState.ssid) {
    wifiElement("wifiConnectionDetails").hidden = false;
    wifiElement("wifiInfoBtn").setAttribute("aria-expanded", "true");
    wifiElement("wifiInfoBtn").focus();
    return;
  }
  wifiSelectedNetwork = network;
  renderWifiNetworks();
  if (network.ssid === wifiDeviceState?.savedSsid || !network.secure) {
    runWifiTask(() => connectSelectedWifi(network.ssid === wifiDeviceState?.savedSsid));
    return;
  }
  wifiText("wifiJoinSsid", network.ssid);
  wifiText("wifiJoinError", "");
  wifiElement("wifiPassword").value = "";
  setWifiPasswordVisible(false);
  wifiElement("wifiJoinDialog").showModal();
  wifiElement("wifiPassword").focus();
}

async function scanWifiNetworks(refreshStatus = true) {
  if (refreshStatus) await refreshWifiStatus();
  if (wifiDeviceState?.connecting) {
    setWifiStatus("Wait for the current Wi-Fi connection attempt to finish.");
    return;
  }
  wifiInitialScanPending = false;
  setWifiBusy(true);
  showWifiListMessage("Scanning Wi-Fi networks...");
  setWifiStatus("Scanning for nearby Wi-Fi networks...");
  for (let attempt = 0; attempt < 5; attempt++) {
    const payload = await wifiClient.scanWifi();
    if (Array.isArray(payload)) {
      const seen = new Set();
      wifiNetworks = payload.filter(network => typeof network.ssid === "string" && network.ssid.length > 0)
        .sort((a, b) => b.rssi - a.rssi)
        .filter(network => !seen.has(network.ssid) && seen.add(network.ssid));
      if (wifiNetworks.length) renderWifiNetworks();
      else showWifiListMessage("No named Wi-Fi networks found. Move closer and refresh networks.");
      setWifiStatus("Scan complete. Tap a network to connect.");
      return;
    }
    if (!payload?.scanning) throw new Error(payload?.message || "Wi-Fi scan failed.");
    if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 5000));
  }
  showWifiListMessage("Scan timed out. Try Scan Wi-Fi again.");
  throw new Error("Wi-Fi scan timed out.");
}

async function connectSelectedWifi(useSaved = false) {
  const ssid = wifiSelectedNetwork?.ssid || "";
  const password = !useSaved && wifiSelectedNetwork?.secure ? wifiElement("wifiPassword")?.value || "" : "";
  if (!ssid.trim() || new TextEncoder().encode(ssid).length > 32) {
    setWifiStatus("Select an available Wi-Fi network.", true);
    return;
  }
  if (wifiSelectedNetwork?.secure && !useSaved && !password) {
    wifiText("wifiJoinError", "Enter the password for this network.");
    wifiElement("wifiPassword")?.focus();
    return;
  }
  if (new TextEncoder().encode(password).length > 64) {
    wifiText("wifiJoinError", "Wi-Fi password must be at most 64 bytes.");
    return;
  }
  await refreshWifiStatus();
  setWifiStatus("Connecting ESP32 to " + ssid + "...");
  let result;
  try {
    result = await wifiClient.connectWifi(ssid, password, useSaved);
  } catch (error) {
    throw new Error("Connection result not received. Join the selected Wi-Fi and reopen hatchai.local, or use HatchAI-ESP32. Refresh to verify before retrying.");
  }
  if (result.accepted === false || (!result.connecting && !result.connected)) {
    await refreshWifiStatus();
    wifiText("wifiJoinError", result.message || "Connection could not start.");
    setWifiStatus(result.message || "Connection failed. Check the Wi-Fi name and password.", true);
    return;
  }
  wifiPendingSsid = ssid;
  wifiElement("wifiPassword").value = "";
  setWifiPasswordVisible(false);
  wifiElement("wifiJoinDialog").close();
  if (result.connecting) applyWifiStatus(result);
  else applyWifiStatus({ ...wifiDeviceState, ...result });
}

function loadSavedWifi() {
  const saved = loadData(WIFI_KEY, {});
  saveData(WIFI_KEY, { ssid: saved.ssid || "", baseUrl: saved.baseUrl || "" });
  // Browser-saved connection flags and passwords are never used as live device status.
}

function saveWifiStatus() {
  saveData(WIFI_KEY, {
    ssid: wifiSelectedNetwork?.ssid || loadData(WIFI_KEY, {}).ssid || "",
    baseUrl: wifiClient?.baseUrl || loadData(WIFI_KEY, {}).baseUrl || ""
  });
}

function resetWifiState(message = "Browser Wi-Fi choices cleared. ESP32 connection is unchanged.") {
  removeData(WIFI_KEY);
  if (wifiElement("wifiPassword")) wifiElement("wifiPassword").value = "";
  wifiSelectedNetwork = null;
  wifiElement("wifiJoinDialog")?.close();
  setWifiPasswordVisible(false);
  if (wifiNetworks.length) renderWifiNetworks();
  setWifiStatus(message);
}

async function forgetWifi() {
  await refreshWifiStatus();
  const ssid = wifiDeviceState.savedSsid || wifiDeviceState.ssid;
  if (!ssid) return;
  if (!window.confirm('Forget "' + ssid + '"? The ESP32 will disconnect. Rejoin HatchAI-ESP32 and open 192.168.4.1 to set up Wi-Fi again.')) return;
  setWifiStatus("Removing the saved network...");
  let result;
  try {
    result = await wifiClient.forgetWifi();
  } catch (error) {
    throw new Error("Forget result not received. Rejoin HatchAI-ESP32 if it appears, then refresh to verify. Saved browser choices have been kept.");
  }
  if (result.forgotten !== true) throw new Error(result.message || "ESP32 could not forget the network.");
  wifiWaitingForSetup = true;
  wifiPendingSsid = "";
  resetWifiState("Network forgotten. Rejoin HatchAI-ESP32 on your phone, then open http://192.168.4.1.");
  markWifiUnavailable();
  wifiText("espConnectedSsid", "Rejoin HatchAI-ESP32");
  wifiText("espWifiBadge", "Setup requested");
}

function setWifiPasswordVisible(visible) {
  const input = wifiElement("wifiPassword");
  const button = wifiElement("toggleWifiPassword");
  if (!input || !button) return;
  input.type = visible ? "text" : "password";
  button.textContent = visible ? "Hide" : "Show";
  button.setAttribute("aria-pressed", String(visible));
}

document.addEventListener("DOMContentLoaded", () => {
  if (!wifiElement("espConnectedSsid")) return;
  loadSavedWifi();
  wifiElement("scanWifiBtn")?.addEventListener("click", () => runWifiTask(scanWifiNetworks));
  wifiElement("wifiJoinForm")?.addEventListener("submit", event => {
    event.preventDefault();
    runWifiTask(() => connectSelectedWifi());
  });
  wifiElement("cancelWifiJoin")?.addEventListener("click", () => wifiElement("wifiJoinDialog").close());
  wifiElement("wifiJoinDialog")?.addEventListener("close", () => {
    wifiElement("wifiPassword").value = "";
    setWifiPasswordVisible(false);
  });
  wifiElement("forgetWifiBtn")?.addEventListener("click", () => runWifiTask(forgetWifi));
  wifiElement("refreshWifiBtn")?.addEventListener("click", () => {
    wifiWaitingForSetup = false;
    runWifiTask(async () => {
      await refreshWifiStatus();
    });
  });
  wifiElement("toggleWifiPassword")?.addEventListener("click", () => {
    setWifiPasswordVisible(wifiElement("wifiPassword").type !== "text");
  });
  wifiElement("wifiInfoBtn")?.addEventListener("click", () => {
    const details = wifiElement("wifiConnectionDetails");
    details.hidden = !details.hidden;
    wifiElement("wifiInfoBtn").setAttribute("aria-expanded", String(!details.hidden));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(wifiStatusTimer);
    else scheduleWifiStatus();
  });
  runWifiTask(async () => {
    const state = await refreshWifiStatus();
    if (!state.connecting) await scanWifiNetworks(false);
  });
});

window.HatchWifi = { scanWifiNetworks, connectSelectedWifi, saveWifiStatus, loadSavedWifi, resetWifiState, forgetWifi };
