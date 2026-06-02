#pragma once

#include <Arduino.h>

class NetworkManager {
public:
  void begin();
  String statusText() const;
  String ipAddress() const;
  String scanNetworksJson();
  String connectToWifi(const String& ssid, const String& password);
  String forgetWifi();

private:
  bool shouldUseStationMode() const;
  bool connectStation(const String& ssid, const String& password, uint32_t timeoutMs);
  String scanResultsJson(int networkCount);
  void startMdns();
  void startAccessPoint();
  String _lastSsid;
  uint32_t _scanStartedMs = 0;
};
