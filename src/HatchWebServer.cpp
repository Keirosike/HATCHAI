#include "HatchWebServer.h"
#include <ctype.h>
#include <FS.h>
#include <Preferences.h>
#include <SPIFFS.h>
#include "JsonBuilder.h"
#include "SessionPolicy.h"

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
  _server.on("/api/predict", HTTP_POST, [this]() { handleApiPredict(); });
  _server.on("/api/predict", HTTP_OPTIONS, [this]() { handleOptions(); });
  _server.on("/api/safety", HTTP_POST, [this]() { handleApiSafety(); });
  _server.on("/api/safety", HTTP_OPTIONS, [this]() { handleOptions(); });
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
  _server.on("/api/wifi/status", HTTP_GET, [this]() { sendJson(_network.statusJson()); });
  _server.on("/api/wifi/status", HTTP_OPTIONS, [this]() { handleOptions(); });
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
  settings.fanOn = parseBoolArg("fanOn", settings.fanOn);
  settings.turnerOn = parseBoolArg("turnerOn", settings.turnerOn);
  settings.turner2On = parseBoolArg("turner2On", settings.turner2On);
  settings.targetTemperatureC =
    parseFloatArg("targetTemperature", settings.targetTemperatureC);
  settings.targetHumidityPercent =
    parseFloatArg("targetHumidity", settings.targetHumidityPercent);
  settings.turnIntervalMinutes =
    parseMinutesArg("turnIntervalMinutes", settings.turnIntervalMinutes);
  settings.turnInterval2Minutes =
    parseMinutesArg("turnInterval2Minutes", settings.turnInterval2Minutes);
  settings.turnDurationSeconds = parseMinutesArg("turnDurationSeconds", settings.turnDurationSeconds);
  settings.turnDuration2Seconds = parseMinutesArg("turnDuration2Seconds", settings.turnDuration2Seconds);
  settings.temperatureOffsetC = parseFloatArg("temperatureOffset", settings.temperatureOffsetC);

  if (!_controller.applySettings(settings)) {
    sendJson("{\"ok\":false,\"message\":\"Settings rejected: target 30-37.8 C, humidity 0-100, offset -2 to 2 C, interval 30-360 minutes, duration 1-600 seconds. Check device storage.\"}", 400);
    return;
  }
  sendJson(_controller.buildStatusJson(_network.statusText(), _network.ipAddress()));
}

void HatchWebServer::handleApiTurn() {
  const String motor = _server.hasArg("motor") ? _server.arg("motor") : "both";
  if (motor != "both" && motor != "1" && motor != "2") {
    sendJson("{\"ok\":false,\"message\":\"motor must be 1, 2, or both\"}", 400);
    return;
  }
  const uint8_t selectedMotor = motor == "both" ? 0 : motor.toInt();
  const String action = _server.hasArg("action") ? _server.arg("action") : "start";
  if (action == "stop") {
    _controller.stopTurnCycle(selectedMotor);
    sendJson(_controller.buildStatusJson(_network.statusText(), _network.ipAddress()));
    return;
  }
  if (action != "start") {
    sendJson("{\"ok\":false,\"message\":\"action must be start or stop\"}", 400);
    return;
  }

  uint32_t pulseMs = HatchConfig::TurnerPulseMs;
  if (_server.hasArg("durationSeconds")) {
    const String text = _server.arg("durationSeconds");
    const long seconds = text.toInt();
    if (seconds < HatchConfig::MinManualTurnSeconds ||
        seconds > HatchConfig::MaxManualTurnSeconds || String(seconds) != text) {
      sendJson("{\"ok\":false,\"message\":\"durationSeconds must be a whole number from 1 to 600\"}", 400);
      return;
    }
    const ControlSettings settings = _controller.settings();
    if (((selectedMotor == 0 || selectedMotor == 1) && settings.turnerOn) ||
        ((selectedMotor == 0 || selectedMotor == 2) && settings.turner2On)) {
      sendJson("{\"ok\":false,\"message\":\"Switch continuous motor control OFF before a timed run\"}", 409);
      return;
    }
    pulseMs = static_cast<uint32_t>(seconds) * 1000UL;
  }
  if (!_controller.triggerTurnCycle(selectedMotor, pulseMs,parseBoolArg("manual",false))) {
    sendJson("{\"ok\":false,\"message\":\"Turner blocked. In manual mode check sensor, temperature and interrupted position; assigned batches must be active before lockdown. Automatic mode also requires enabled turning and verified SD recovery.\"}", 409);
    return;
  }
  sendJson(_controller.buildStatusJson(_network.statusText(), _network.ipAddress()));
}

void HatchWebServer::handleApiPredict() {
  const String batchId = bodyArg("batchId");
  const String incubationDayText = bodyArg("incubationDay");
  const int incubationDay = incubationDayText.toInt();

  sendJson(_controller.buildPredictionJson(batchId, incubationDay));
}

void HatchWebServer::handleApiSafety() {
  // New safety actions require the existing session; legacy routes keep their contract.
  if (!HatchAccess::tokenAllowed(hasActiveSession(),_server.arg("token").length(),_server.arg("token")==_sessionToken)) {
    sendJson("{\"ok\":false,\"message\":\"Log in again to change device safety settings.\"}", 401); return;
  }
  const String action = _server.arg("action");
  bool ok = false;
  if (action == "ack") ok = _controller.acknowledgeAlarm();
  else if (action == "arm" || action == "disarm") ok = _controller.setTurningArmed(action == "arm");
  else if (action == "clockAuto") ok = _controller.autoSyncClock(_server.arg("dateTime"));
  else if (action == "clock") ok = _controller.setClock(_server.arg("dateTime"));
  else if (action == "recoveryRetry") ok = _controller.retryRecovery();
  else if (action == "recoveryInitialize") ok = _controller.initializeRecovery();
  else if (action == "positionVerified") {
    const String motor=_server.arg("motor");
    if(motor=="1" || motor=="2") ok=_controller.acknowledgePosition(motor.toInt());
  }
  else if (action == "batch") {
    const String motor = _server.arg("motor");
    if (motor == "1" || motor == "2") ok = _controller.bindBatch(motor.toInt(),
      _server.arg("batchId"), _server.arg("startDate"), parseBoolArg("active", false),
      _server.hasArg("startTime")?_server.arg("startTime"):String("00:00:00"),
      parseMinutesArg("durationDays",HatchConfig::DefaultIncubationDays),_server.arg("batchStatus"));
  } else if (action == "batchUpdate") {
    const String roller=_server.arg("roller");
    if (_server.hasArg("roller") && roller!="0" && roller!="1" && roller!="2" && roller!="3") {
      sendJson("{\"ok\":false,\"message\":\"Choose lower, upper, or both rollers.\"}",400); return;
    }
    ok = _controller.updateBoundBatch(_server.arg("batchId"), _server.arg("startDate"),
      parseBoolArg("active", false),_server.hasArg("startTime")?_server.arg("startTime"):String("00:00:00"),
      parseMinutesArg("durationDays",HatchConfig::DefaultIncubationDays),_server.arg("batchStatus"),roller.toInt(),_server.arg("turningEnd"));
  }
  if(ok && (action=="batch" || action=="batchUpdate") && _server.hasArg("batchLabel")) {
    ok=_controller.updateBatchMetadata(_server.arg("batchId"),_server.arg("batchLabel"),_server.arg("batchName"),parseMinutesArg("eggCount",0));
  }
  if (!ok) {
    const String message=action=="clockAuto" ? "Automatic clock sync could not be verified. Check RTC connection, browser time and saved recovery dates; wait for a motor run to finish." :
      action=="batchUpdate" ? "Batch could not be saved. Check roller availability, valid start/turning-end times (by day 18), and verified SD recovery." :
      "Action blocked. Check sensor recovery, temperature, motor position and storage in Component status.";
    sendJson("{\"ok\":false,\"message\":"+HatchJson::quote(message)+"}", 409); return;
  }
  sendJson(_controller.buildStatusJson(_network.statusText(), _network.ipAddress()));
}

void HatchWebServer::handleAccountGet() {
  sendJson("{\"username\":" + HatchJson::quote(storedUsername()) + "}");
}

void HatchWebServer::handleAccountSave() {
  if(!HatchAccess::tokenAllowed(hasActiveSession(),_server.arg("token").length(),_server.arg("token")==_sessionToken)) {
    sendJson("{\"ok\":false,\"message\":\"Log in before changing account credentials.\"}",401); return;
  }
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

  if (token.length() < 8 || token.length()>96 || username.length()>64 || password.length()>128) {
    sendJson("{\"ok\":false,\"message\":\"Invalid session token\"}", 400);
    return;
  }

  if (!HatchAccess::loginAllowed(password.length()>0,credentialsValid(username,password))) {
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

  sendJson(_network.connectToWifi(ssid, password, parseBoolArg("useSaved", false)));
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

  const int queryIndex = path.indexOf('?');
  if (queryIndex >= 0) {
    path = path.substring(0, queryIndex);
  }

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

  addCorsHeaders();
  _server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  _server.sendHeader("Pragma", "no-cache");
  _server.sendHeader("Expires", "0");
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

  const String text = _server.arg(name);
  char* end = nullptr;
  const float value = strtof(text.c_str(), &end);
  return end != text.c_str() && *end == 0 && isfinite(value) ? value : NAN;
}

uint16_t HatchWebServer::parseMinutesArg(
  const String& name,
  uint16_t fallback
) {
  if (!_server.hasArg(name)) {
    return fallback;
  }

  const String text = _server.arg(name);
  const long minutes = text.toInt();
  if (minutes <= 0 || minutes > 65535 || String(minutes) != text) return 0;
  return static_cast<uint16_t>(minutes);
}

String HatchWebServer::bodyArg(const String& name) {
  if (_server.hasArg(name)) {
    return _server.arg(name);
  }

  return jsonBodyValue(name);
}

String HatchWebServer::jsonBodyValue(const String& name) {
  const String body = _server.hasArg("plain") ? _server.arg("plain") : "";

  if (body.length() == 0) {
    return "";
  }

  const String token = String("\"") + name + "\"";
  int index = body.indexOf(token);

  if (index < 0) {
    return "";
  }

  index = body.indexOf(':', index + token.length());

  if (index < 0) {
    return "";
  }

  index++;

  while (index < body.length() && isspace(body[index])) {
    index++;
  }

  if (index >= body.length()) {
    return "";
  }

  if (body[index] == '"') {
    const int end = body.indexOf('"', index + 1);
    return end > index ? body.substring(index + 1, end) : "";
  }

  int end = index;

  while (
    end < body.length() &&
    body[end] != ',' &&
    body[end] != '}' &&
    !isspace(body[end])
  ) {
    end++;
  }

  return body.substring(index, end);
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
