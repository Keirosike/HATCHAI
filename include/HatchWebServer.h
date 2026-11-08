#pragma once

#include <Arduino.h>
#include <WebServer.h>
#include "IncubatorController.h"
#include "NetworkManager.h"
#include "ChickBuzzer.h"
#include "NotificationRuntime.h"

class HatchWebServer {
public:
  HatchWebServer(IncubatorController& controller, NetworkManager& network,HatchPairing::NotificationRuntime& notifications);

  void begin();
  void handleClient();

private:
  void registerRoutes();
  void handleNotificationPairing(const char* operation);
  void handleCameraEvent();
  void handleCameraStatus();
  String _cameraIp;
  uint32_t _cameraSeenMs=0, _cameraSequence=0;
  bool _cameraSeen=false, _cameraChick=false, _cameraDetectorOk=false;
  uint32_t _cameraBoot=0;
  ChickBuzzer _chickBuzzer;
  void handleApiData();
  void handleApiControl();
  void handleApiTurn();
  void handleApiPredict();
  void handleApiSafety();
  void handleAccountGet();
  void handleAccountSave();
  void handleSessionStart();
  void handleSessionKeepAlive();
  void handleSessionEnd();
  void handleSessionStatus();
  void handleWifiScan();
  void handleWifiConnect();
  void handleWifiForget();
  void handleOptions();
  void handleStaticFile();
  void sendJson(const String& payload, int statusCode = 200);
  void sendNotFound();
  void addCorsHeaders();

  String contentTypeFor(const String& path) const;
  bool parseBoolArg(const String& name, bool fallback);
  float parseFloatArg(const String& name, float fallback);
  uint16_t parseMinutesArg(const String& name, uint16_t fallback);
  String bodyArg(const String& name);
  String jsonBodyValue(const String& name);
  bool credentialsValid(const String& username, const String& password);
  String storedUsername();
  String storedPassword();
  bool hasActiveSession() const;
  void refreshSession(const String& token, const String& username);

  WebServer _server;
  IncubatorController& _controller;
  NetworkManager& _network;
  HatchPairing::NotificationRuntime& _notifications;
  String _sessionToken;
  String _sessionUsername;
  unsigned long _sessionLastSeenMs = 0;
};
