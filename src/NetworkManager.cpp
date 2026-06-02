#include "NetworkManager.h"
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WiFi.h>
#include "Config.h"
#include "JsonBuilder.h"

void NetworkManager::begin() {
  Preferences preferences;
  preferences.begin("hatchai-wifi", true);
  const String savedSsid = preferences.getString("ssid", "");
  const String savedPassword = preferences.getString("password", "");
  preferences.end();

  if (savedSsid.length() > 0 && connectStation(savedSsid, savedPassword, 15000)) {
    return;
  }

  if (!shouldUseStationMode()) {
    startAccessPoint();
    return;
  }

  if (connectStation(HatchConfig::WifiSsid, HatchConfig::WifiPassword, 15000)) {
    return;
  }

  Serial.println("Wi-Fi connection failed. Starting access point instead.");
  startAccessPoint();
}

String NetworkManager::statusText() const {
  if (WiFi.status() == WL_CONNECTED) {
    return "Online";
  }

  if (WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA) {
    return "Access Point";
  }

  return "Offline";
}

String NetworkManager::ipAddress() const {
  if (WiFi.status() == WL_CONNECTED) {
    return WiFi.localIP().toString();
  }

  if (WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA) {
    return WiFi.softAPIP().toString();
  }

  return "0.0.0.0";
}

String NetworkManager::scanNetworksJson() {
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
  delay(50);
  WiFi.scanNetworks(true, true);
  _scanStartedMs = millis();

  return "{\"scanning\":true,\"message\":\"Scan started\"}";
}

String NetworkManager::scanResultsJson(int networkCount) {
  if (networkCount <= 0) {
    return "[]";
  }

  String json = "[";

  for (int i = 0; i < networkCount; i++) {
    if (i > 0) {
      json += ",";
    }

    json += "{";
    json += "\"ssid\":";
    json += HatchJson::quote(WiFi.SSID(i));
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

String NetworkManager::connectToWifi(const String& ssid, const String& password) {
  if (ssid.length() == 0) {
    return "{\"connected\":false,\"message\":\"SSID is required\"}";
  }

  WiFi.scanDelete();
  _scanStartedMs = 0;

  const bool connected = connectStation(ssid, password, 20000);

  if (connected) {
    Preferences preferences;
    preferences.begin("hatchai-wifi", false);
    preferences.putString("ssid", ssid);
    preferences.putString("password", password);
    preferences.end();
  }

  String json = "{";
  json += "\"connected\":";
  json += HatchJson::boolValue(connected);
  json += ",";
  json += "\"ssid\":";
  json += HatchJson::quote(ssid);
  json += ",";
  json += "\"status\":";
  json += HatchJson::quote(statusText());
  json += ",";
  json += "\"ipAddress\":";
  json += HatchJson::quote(ipAddress());
  json += ",";
  json += "\"message\":";
  json += HatchJson::quote(connected ? "Connected" : "Connection failed");
  json += "}";

  return json;
}

String NetworkManager::forgetWifi() {
  Preferences preferences;
  preferences.begin("hatchai-wifi", false);
  preferences.remove("ssid");
  preferences.remove("password");
  preferences.end();

  WiFi.disconnect(false);

  return "{\"forgotten\":true,\"message\":\"Saved Wi-Fi credentials removed\"}";
}

bool NetworkManager::shouldUseStationMode() const {
  const String ssid = HatchConfig::WifiSsid;

  return ssid.length() > 0 && !ssid.startsWith("YOUR_");
}

bool NetworkManager::connectStation(
  const String& ssid,
  const String& password,
  uint32_t timeoutMs
) {
  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(ssid.c_str(), password.c_str());
  _lastSsid = ssid;

  Serial.print("Connecting to Wi-Fi");

  const uint32_t started = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - started < timeoutMs) {
    delay(250);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    startMdns();

    Serial.print("HatchAI online at http://");
    Serial.println(WiFi.localIP());
    Serial.println("mDNS name: http://hatchai.local");
    return true;
  }

  WiFi.disconnect(false);
  return false;
}

void NetworkManager::startMdns() {
  if (MDNS.begin("hatchai")) {
    MDNS.addService("http", "tcp", HatchConfig::WebServerPort);
  }
}

void NetworkManager::startAccessPoint() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(HatchConfig::AccessPointSsid, HatchConfig::AccessPointPassword);
  startMdns();

  Serial.print("HatchAI access point started: ");
  Serial.println(HatchConfig::AccessPointSsid);
  Serial.print("Open http://");
  Serial.println(WiFi.softAPIP());
}
