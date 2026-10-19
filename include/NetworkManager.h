#pragma once

#include <Arduino.h>

class NetworkManager {
public:
  void begin();
  void update();
  String statusText() const;
  String ipAddress() const;
  String statusJson() const;
  String scanNetworksJson();
  String connectToWifi(const String& ssid, const String& password, bool useSaved = false);
  String forgetWifi();

private:
  enum class ConnectionState : uint8_t { Idle, Queued, Disconnecting, Connecting, Connected, Failed };
  bool shouldUseStationMode() const;
  bool isConnecting() const;
  void queueConnection(const String& ssid, const String& password, bool persist);
  void failConnection(const char* error);
  bool saveConnectedCredentials();
  const char* connectionStateText() const;
  String scanResultsJson(int networkCount);
  void startMdns();
  void startAccessPoint();
  String _connectionSsid;
  String _connectionPassword;
  String _savedSsid;
  ConnectionState _connectionState = ConnectionState::Idle;
  const char* _connectionError = "";
  bool _persistOnConnect = false;
  bool _credentialsSaved = false;
  bool _retrySaved = false;
  bool _bootFallbackPending = false;
  uint32_t _connectionQueuedMs = 0;
  uint32_t _connectionStartedMs = 0;
  uint32_t _lastReconnectAttemptMs = 0;
  bool _accessPointStarted = false;
  bool _forgetPending = false;
  uint32_t _forgetRequestedMs = 0;
  uint32_t _scanStartedMs = 0;
};
