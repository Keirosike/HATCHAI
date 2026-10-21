#pragma once

#include <Arduino.h>
#include "IncubatorTypes.h"
#include "RecoveryStorage.h"

class DataLogger {
public:
  DataLogger(uint8_t csPin, const char* logPath);

  void begin();
  bool isReady() const;
  String statusText() const;
  RecoveryStorage& storage() { return _storage; }
  const RecoveryStorage& storage() const { return _storage; }
  void logReading(
    const String& timestamp,
    const SensorReading& reading,
    const ControlSettings& settings,
    const EggTurningMetrics& turningMetrics,
    const EggTurningMetrics& turningMetrics2,
    bool bulb1On,
    bool fanOn,
    bool turnerOn,
    bool turner2On
  );

private:
  uint8_t _csPin;
  const char* _logPath;
  uint32_t _lastLogMs = 0;
  bool _logged = false;
  RecoveryStorage _storage;
};
