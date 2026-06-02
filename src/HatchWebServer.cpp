#include "HatchWebServer.h"
#include <FS.h>
#include <Preferences.h>
#include <SPIFFS.h>
#include "JsonBuilder.h"

namespace {
constexpr unsigned long SessionTimeoutMs = 90000;
const char* AccountNamespace = "hatchai";
const char* DefaultUsername = "admin";
const char* DefaultPassword = "1234";
}

HatchWebServer::HatchWebServer(
  IncubatorController& controller,
  NetworkManager& network
) : _server(HatchConfig::WebServerPort), _controller(controller), _network(network) {}

void HatchWebServer::begin() {
  registerRoutes();
  _server.begin();
  Serial.println("HTTP server started");
}

void HatchWebServer::handleClient() {
  _server.handleClient();
}

void HatchWebServer::registerRoutes() {
  _server.on("/api/data", HTTP_GET, [this]() { handleApiData(); });
  _server.on("/api/control", HTTP_POST, [this]() { handleApiControl(); });
  _server.on("/api/control", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/api/turn", HTTP_POST, [this]() { handleApiTurn(); });
  _server.on("/api/turn", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/api/account", HTTP_GET, [this]() { handleAccountGet(); });
  _server.on("/api/account", HTTP_POST, [this]() { handleAccountSave(); });
  _server.on("/api/account", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/api/session/start", HTTP_POST, [this]() { handleSessionStart(); });
  _server.on("/api/session/start", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/api/session/keepalive", HTTP_POST, [this]() { handleSessionKeepAlive(); });
  _server.on("/api/session/keepalive", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/api/session/end", HTTP_POST, [this]() { handleSessionEnd(); });
  _server.on("/api/session/end", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/api/session/status", HTTP_GET, [this]() { handleSessionStatus(); });
  _server.on("/api/session/status", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/scan-wifi", HTTP_GET, [this]() { handleWifiScan(); });
  _server.on("/scan-wifi", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/api/wifi/scan", HTTP_GET, [this]() { handleWifiScan(); });
  _server.on("/api/wifi/scan", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/api/wifi/connect", HTTP_POST, [this]() { handleWifiConnect(); });
  _server.on("/api/wifi/connect", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/api/wifi/forget", HTTP_POST, [this]() { handleWifiForget(); });
  _server.on("/api/wifi/forget", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/connect-wifi", HTTP_POST, [this]() { handleWifiConnect(); });
  _server.on("/connect-wifi", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.onNotFound([this]() { handleStaticFile(); });
}

void HatchWebServer::handleApiData() {
  sendJson(_controller.buildStatusJson(_network.statusText(), _network.ipAddress()));
}

void HatchWebServer::handleApiControl() {
  ControlSettings settings = _controller.settings();

  settings.autoMode = parseBoolArg("autoMode", settings.autoMode);
  settings.heaterOn = parseBoolArg("bulbOn", settings.heaterOn);
  settings.bulb2On = parseBoolArg("bulb2On", settings.heaterOn);
  settings.bulb2On = parseBoolArg("auxiliaryOn", settings.bulb2On);
  settings.fanOn = parseBoolArg("fanOn", settings.fanOn);
  settings.turnerOn = parseBoolArg("turnerOn", settings.turnerOn);
  settings.targetTemperatureC =
    parseFloatArg("targetTemperature", settings.targetTemperatureC);
  settings.targetHumidityPercent =
    parseFloatArg("targetHumidity", settings.targetHumidityPercent);
  settings.turnIntervalMinutes =
    parseMinutesArg("turnIntervalMinutes", settings.turnIntervalMinutes);

  _controller.applySettings(settings);
  sendJson(_controller.buildStatusJson(_network.statusText(), _network.ipAddress()));
}

void HatchWebServer::handleApiTurn() {
  _controller.triggerTurnCycle();
  sendJson(_controller.buildStatusJson(_network.statusText(), _network.ipAddress()));
}

void HatchWebServer::handleAccountGet() {
  sendJson("{\"username\":" + HatchJson::quote(storedUsername()) + "}");
}

void HatchWebServer::handleAccountSave() {
  const String username = _server.hasArg("username") ? _server.arg("username") : "";
  const String password = _server.hasArg("password") ? _server.arg("password") : "";

  if (username.length() == 0) {
    sendJson("{\"ok\":false,\"message\":\"Username is required\"}", 400);
    return;
  }

  Preferences preferences;
  preferences.begin(AccountNamespace, false);
  preferences.putString("user", username);

  if (password.length() > 0) {
    preferences.putString("pass", password);
  }

  preferences.end();

  sendJson("{\"ok\":true,\"username\":" + HatchJson::quote(username) + "}");
}

void HatchWebServer::handleSessionStart() {
  const String token = _server.hasArg("token") ? _server.arg("token") : "";
  const String username = _server.hasArg("username") ? _server.arg("username") : "user";
  const String password = _server.hasArg("password") ? _server.arg("password") : "";

  if (token.length() < 8) {
    sendJson("{\"ok\":false,\"message\":\"Invalid session token\"}", 400);
    return;
  }

  if (password.length() > 0 && !credentialsValid(username, password)) {
    sendJson("{\"ok\":false,\"message\":\"Invalid username or password\"}", 401);
    return;
  }

  if (hasActiveSession() && _sessionToken != token && _sessionUsername != username) {
    sendJson(
      "{\"ok\":false,\"locked\":true,\"message\":\"Another user is already logged in\"}",
      409
    );
    return;
  }

  refreshSession(token, username);
  sendJson("{\"ok\":true,\"locked\":false,\"message\":\"Session started\"}");
}

void HatchWebServer::handleSessionKeepAlive() {
  const String token = _server.hasArg("token") ? _server.arg("token") : "";

  if (!hasActiveSession()) {
    sendJson("{\"ok\":false,\"active\":false,\"message\":\"Session expired\"}", 401);
    return;
  }

  if (_sessionToken != token) {
    sendJson("{\"ok\":false,\"locked\":true,\"message\":\"Session belongs to another user\"}", 409);
    return;
  }

  refreshSession(_sessionToken, _sessionUsername);
  sendJson("{\"ok\":true,\"active\":true,\"message\":\"Session refreshed\"}");
}

void HatchWebServer::handleSessionEnd() {
  const String token = _server.hasArg("token") ? _server.arg("token") : "";

  if (_sessionToken == token || !hasActiveSession()) {
    _sessionToken = "";
    _sessionUsername = "";
    _sessionLastSeenMs = 0;
  }

  sendJson("{\"ok\":true,\"active\":false,\"message\":\"Session ended\"}");
}

void HatchWebServer::handleSessionStatus() {
  if (!hasActiveSession()) {
    sendJson("{\"active\":false,\"locked\":false}");
    return;
  }

  sendJson("{\"active\":true,\"locked\":true}");
}

void HatchWebServer::handleWifiScan() {
  sendJson(_network.scanNetworksJson());
}

void HatchWebServer::handleWifiConnect() {
  const String ssid = _server.hasArg("ssid") ? _server.arg("ssid") : "";
  const String password = _server.hasArg("password") ? _server.arg("password") : "";

  sendJson(_network.connectToWifi(ssid, password));
}

void HatchWebServer::handleWifiForget() {
  sendJson(_network.forgetWifi());
}

void HatchWebServer::handleOptions() {
  addCorsHeaders();
  _server.send(204);
}

void HatchWebServer::handleStaticFile() {
  String path = _server.uri();

  if (path == "/") {
    path = "/index.html";
  }

  if (path.endsWith("/")) {
    path += "index.html";
  }

  if (!SPIFFS.exists(path)) {
    sendNotFound();
    return;
  }

  File file = SPIFFS.open(path, "r");

  if (!file) {
    sendNotFound();
    return;
  }

  _server.streamFile(file, contentTypeFor(path));
  file.close();
}

void HatchWebServer::sendJson(const String& payload, int statusCode) {
  addCorsHeaders();
  _server.sendHeader("Cache-Control", "no-store");
  _server.send(statusCode, "application/json", payload);
}

void HatchWebServer::sendNotFound() {
  addCorsHeaders();
  _server.send(404, "text/plain", "Not found");
}

void HatchWebServer::addCorsHeaders() {
  _server.sendHeader("Access-Control-Allow-Origin", "*");
  _server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  _server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

String HatchWebServer::contentTypeFor(const String& path) const {
  if (path.endsWith(".html")) {
    return "text/html";
  }

  if (path.endsWith(".css")) {
    return "text/css";
  }

  if (path.endsWith(".js")) {
    return "application/javascript";
  }

  if (path.endsWith(".svg")) {
    return "image/svg+xml";
  }

  if (path.endsWith(".webp")) {
    return "image/webp";
  }

  if (path.endsWith(".woff2")) {
    return "font/woff2";
  }

  return "text/plain";
}

bool HatchWebServer::parseBoolArg(const String& name, bool fallback) {
  if (!_server.hasArg(name)) {
    return fallback;
  }

  String value = _server.arg(name);
  value.toLowerCase();

  return value == "1" || value == "true" || value == "on" || value == "yes";
}

float HatchWebServer::parseFloatArg(const String& name, float fallback) {
  if (!_server.hasArg(name)) {
    return fallback;
  }

  return _server.arg(name).toFloat();
}

uint16_t HatchWebServer::parseMinutesArg(
  const String& name,
  uint16_t fallback
) {
  if (!_server.hasArg(name)) {
    return fallback;
  }

  const int minutes = _server.arg(name).toInt();

  if (minutes <= 0) {
    return fallback;
  }

  return static_cast<uint16_t>(minutes);
}

bool HatchWebServer::credentialsValid(const String& username, const String& password) {
  return username == storedUsername() && password == storedPassword();
}

String HatchWebServer::storedUsername() {
  Preferences preferences;
  preferences.begin(AccountNamespace, true);
  const String username = preferences.getString("user", DefaultUsername);
  preferences.end();
  return username;
}

String HatchWebServer::storedPassword() {
  Preferences preferences;
  preferences.begin(AccountNamespace, true);
  const String password = preferences.getString("pass", DefaultPassword);
  preferences.end();
  return password;
}

bool HatchWebServer::hasActiveSession() const {
  if (_sessionToken.length() == 0) {
    return false;
  }

  return millis() - _sessionLastSeenMs < SessionTimeoutMs;
}

void HatchWebServer::refreshSession(const String& token, const String& username) {
  _sessionToken = token;
  _sessionUsername = username;
  _sessionLastSeenMs = millis();
}
