#include "NetworkManager.h"
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include "Config.h"
#include "JsonBuilder.h"

void NetworkManager::begin() {
  // Preferences is the credential store; keep the driver's copy in RAM.
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  startAccessPoint();
  Preferences preferences;
  preferences.begin("hatchai-wifi", true);
  const String savedSsid = preferences.getString("ssid", "");
  _savedSsid = savedSsid;
  const String savedPassword = preferences.getString("password", "");
  preferences.end();

  if (savedSsid.length() > 0) {
    _bootFallbackPending = shouldUseStationMode() && savedSsid != HatchConfig::WifiSsid;
    queueConnection(savedSsid, savedPassword, false);
    return;
  }

  if (shouldUseStationMode()) {
    queueConnection(HatchConfig::WifiSsid, HatchConfig::WifiPassword, false);
  }
}

void NetworkManager::update() {
  const uint32_t now = millis();
  if (_forgetPending) {
    if (now - _forgetRequestedMs < HatchConfig::WifiForgetGraceMs) return;
    _forgetPending = false;
    _connectionState = ConnectionState::Idle;
    _connectionSsid = "";
    _connectionPassword = "";
    _connectionError = "";
    _retrySaved = false;
    _bootFallbackPending = false;
    _credentialsSaved = false;
    WiFi.disconnect(false, true);
    if (!_accessPointStarted) startAccessPoint();
    return;
  }

  if (_connectionState == ConnectionState::Queued) {
    if (now - _connectionQueuedMs < HatchConfig::WifiConnectStartDelayMs) return;
    if (WiFi.scanComplete() == WIFI_SCAN_RUNNING) esp_wifi_scan_stop();
    WiFi.scanDelete();
    _scanStartedMs = 0;
    WiFi.disconnect(false);
    _connectionState = ConnectionState::Disconnecting;
    _connectionStartedMs = now;
    return;
  }

  const wl_status_t status = WiFi.status();
  if (_connectionState == ConnectionState::Disconnecting) {
    // Wait for the old station's event before accepting a same-SSID success.
    if (status == WL_CONNECTED) {
      if (now - _connectionStartedMs >= HatchConfig::WifiConnectTimeoutMs) failConnection("connection_failed");
      return;
    }
    _connectionState = ConnectionState::Connecting;
    WiFi.begin(_connectionSsid.c_str(), _connectionPassword.c_str());
    return;
  }
  if (_connectionState == ConnectionState::Connecting) {
    if (status == WL_CONNECTED && WiFi.SSID() == _connectionSsid) {
      _credentialsSaved = _persistOnConnect ? saveConnectedCredentials() : _savedSsid == _connectionSsid;
      _connectionPassword = "";
      _connectionState = ConnectionState::Connected;
      _bootFallbackPending = false;
      _retrySaved = _credentialsSaved;
      startMdns();
      Serial.println("HatchAI station connected");
      return;
    }
    const uint32_t elapsed = now - _connectionStartedMs;
    if (elapsed >= HatchConfig::WifiConnectSettleMs && status == WL_NO_SSID_AVAIL) {
      failConnection("network_unavailable");
    } else if ((elapsed >= HatchConfig::WifiConnectSettleMs && status == WL_CONNECT_FAILED) ||
               elapsed >= HatchConfig::WifiConnectTimeoutMs) {
      failConnection("connection_failed");
    }
    return;
  }

  if (_connectionState == ConnectionState::Connected && status != WL_CONNECTED) {
    failConnection("network_unavailable");
  }
  if (_connectionState == ConnectionState::Failed && _bootFallbackPending) {
    _bootFallbackPending = false;
    queueConnection(HatchConfig::WifiSsid, HatchConfig::WifiPassword, false);
    return;
  }
  if (_retrySaved && _savedSsid.length() > 0 && status != WL_CONNECTED &&
      now - _lastReconnectAttemptMs >= HatchConfig::WifiReconnectIntervalMs) {
    Preferences preferences;
    if (preferences.begin("hatchai-wifi", true)) {
      const String password = preferences.getString("password", "");
      preferences.end();
      queueConnection(_savedSsid, password, false);
    } else {
      _lastReconnectAttemptMs = now;
    }
  }
}

String NetworkManager::statusJson() const {
  const bool connected = WiFi.status() == WL_CONNECTED;
  const bool accessPoint = _accessPointStarted;
  String json;
  json.reserve(560);
  json = "{\"connected\":" + HatchJson::boolValue(connected);
  json += ",\"ssid\":" + HatchJson::quote(connected ? WiFi.SSID() : String(""));
  json += ",\"savedSsid\":" + HatchJson::quote(_savedSsid);
  json += ",\"connecting\":" + HatchJson::boolValue(isConnecting());
  json += ",\"connectionState\":" + HatchJson::quote(connectionStateText());
  json += ",\"requestedSsid\":" + HatchJson::quote(_connectionSsid);
  json += ",\"error\":" + HatchJson::quote(_connectionError);
  json += ",\"credentialsSaved\":" + HatchJson::boolValue(_credentialsSaved);
  json += ",\"status\":" + HatchJson::quote(statusText());
  json += ",\"ipAddress\":" + HatchJson::quote(ipAddress());
  json += ",\"rssi\":" + (connected ? String(WiFi.RSSI()) : String("null"));
  json += ",\"apSsid\":" + HatchJson::quote(accessPoint ? WiFi.softAPSSID() : String(""));
  json += ",\"apIpAddress\":" + HatchJson::quote(accessPoint ? WiFi.softAPIP().toString() : String(""));
  json += "}";
  return json;
}

String NetworkManager::statusText() const {
  if (WiFi.status() == WL_CONNECTED) {
    return "Online";
  }

  if (_accessPointStarted) {
    return "Access Point";
  }

  return "Offline";
}

String NetworkManager::ipAddress() const {
  if (WiFi.status() == WL_CONNECTED) {
    return WiFi.localIP().toString();
  }

  if (_accessPointStarted) {
    return WiFi.softAPIP().toString();
  }

  return "0.0.0.0";
}

String NetworkManager::scanNetworksJson() {
  if (isConnecting() || _forgetPending) {
    return "{\"scanning\":false,\"message\":\"Wait for the Wi-Fi connection attempt to finish\"}";
  }
  WiFi.mode(WIFI_AP_STA);

  int networkCount = WiFi.scanComplete();

  if (networkCount == WIFI_SCAN_RUNNING) {
    return "{\"scanning\":true,\"message\":\"Scan is still running\"}";
  }

  if (networkCount >= 0) {
    String json = scanResultsJson(networkCount);
    WiFi.scanDelete();
    _scanStartedMs = 0;
    return json;
  }

  WiFi.scanDelete();
  WiFi.scanNetworks(true, true);
  _scanStartedMs = millis();

  return "{\"scanning\":true,\"message\":\"Scan started\"}";
}

String NetworkManager::scanResultsJson(int networkCount) {
  if (networkCount <= 0) {
    return "[]";
  }

  String json = "[";

  int emitted = 0;
  for (int i = 0; i < networkCount && emitted < HatchConfig::WifiScanResultLimit; i++) {
    const String ssid = WiFi.SSID(i);
    bool duplicate = false;
    for (int previous = 0; previous < networkCount; previous++) {
      if (WiFi.SSID(previous) == ssid && (WiFi.RSSI(previous) > WiFi.RSSI(i) ||
          (WiFi.RSSI(previous) == WiFi.RSSI(i) && previous < i))) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;
    if (emitted++ > 0) {
      json += ",";
    }

    json += "{";
    json += "\"ssid\":";
    json += HatchJson::quote(ssid);
    json += ",";
    json += "\"rssi\":";
    json += String(WiFi.RSSI(i));
    json += ",";
    json += "\"secure\":";
    json += HatchJson::boolValue(WiFi.encryptionType(i) != WIFI_AUTH_OPEN);
    json += "}";
  }

  json += "]";
  return json;
}

String NetworkManager::connectToWifi(const String& ssid, const String& password, bool useSaved) {
  if (_forgetPending || isConnecting()) {
    return "{\"accepted\":false,\"connected\":false,\"message\":\"Another Wi-Fi operation is in progress\"}";
  }
  if (ssid.length() == 0 || ssid.length() > 32 || password.length() > 64) {
    return "{\"accepted\":false,\"connected\":false,\"message\":\"SSID must be 1-32 bytes and password at most 64 bytes\"}";
  }

  String connectionPassword = password;
  if (useSaved) {
    Preferences preferences;
    if (!preferences.begin("hatchai-wifi", true)) {
      return "{\"accepted\":false,\"connected\":false,\"message\":\"Saved network is unavailable\"}";
    }
    const bool matches = preferences.getString("ssid", "") == ssid && preferences.isKey("password");
    if (matches) connectionPassword = preferences.getString("password", "");
    preferences.end();
    if (!matches) {
      return "{\"accepted\":false,\"connected\":false,\"message\":\"This network has no saved credentials\"}";
    }
  }
  _bootFallbackPending = false;
  queueConnection(ssid, connectionPassword, !useSaved);
  String json = statusJson();
  json.remove(json.length() - 1);
  json += ",\"accepted\":true}";
  return json;
}

String NetworkManager::forgetWifi() {
  Preferences preferences;
  if (!preferences.begin("hatchai-wifi", false)) {
    return "{\"forgotten\":false,\"message\":\"Could not open saved Wi-Fi settings\"}";
  }
  const bool cleared = preferences.clear();
  preferences.end();

  if (!cleared) {
    return "{\"forgotten\":false,\"message\":\"Could not remove saved Wi-Fi credentials\"}";
  }

  _savedSsid = "";
  // Allow the HTTP acknowledgement to leave before dropping the station connection.
  _forgetRequestedMs = millis();
  _forgetPending = true;
  return "{\"forgotten\":true,\"message\":\"Saved Wi-Fi credentials removed; setup mode is starting\"}";
}

bool NetworkManager::shouldUseStationMode() const {
  const String ssid = HatchConfig::WifiSsid;

  return ssid.length() > 0 && !ssid.startsWith("YOUR_");
}

bool NetworkManager::isConnecting() const {
  return _connectionState == ConnectionState::Queued || _connectionState == ConnectionState::Disconnecting ||
    _connectionState == ConnectionState::Connecting;
}

const char* NetworkManager::connectionStateText() const {
  if (isConnecting()) return "connecting";
  if (_connectionState == ConnectionState::Connected) return "connected";
  if (_connectionState == ConnectionState::Failed) return "failed";
  return "idle";
}

void NetworkManager::queueConnection(const String& ssid, const String& password, bool persist) {
  _connectionSsid = ssid;
  _connectionPassword = password;
  _persistOnConnect = persist;
  _credentialsSaved = false;
  _retrySaved = !persist && _savedSsid.length() > 0;
  _connectionError = "";
  _connectionState = ConnectionState::Queued;
  _connectionQueuedMs = millis();
  _lastReconnectAttemptMs = _connectionQueuedMs;
}

void NetworkManager::failConnection(const char* error) {
  WiFi.disconnect(false);
  _connectionState = ConnectionState::Failed;
  _connectionError = error;
  _connectionPassword = "";
  _lastReconnectAttemptMs = millis();
}

bool NetworkManager::saveConnectedCredentials() {
  Preferences preferences;
  if (!preferences.begin("hatchai-wifi", false)) return false;
  preferences.putString("ssid", _connectionSsid);
  preferences.putString("password", _connectionPassword);
  _savedSsid = preferences.getString("ssid", "");
  const bool saved = _savedSsid == _connectionSsid && preferences.isKey("password") &&
    preferences.getString("password", "") == _connectionPassword;
  preferences.end();
  return saved;
}

void NetworkManager::startMdns() {
  if (MDNS.begin("hatchai")) {
    MDNS.addService("http", "tcp", HatchConfig::WebServerPort);
  }
}

void NetworkManager::startAccessPoint() {
  WiFi.mode(WIFI_AP_STA);
  _accessPointStarted = WiFi.softAP(HatchConfig::AccessPointSsid, HatchConfig::AccessPointPassword);
  if (!_accessPointStarted) {
    Serial.println("HatchAI access point could not start");
    return;
  }
  startMdns();

  Serial.print("HatchAI access point started: ");
  Serial.println(HatchConfig::AccessPointSsid);
  Serial.print("Open http://");
  Serial.println(WiFi.softAPIP());
}
