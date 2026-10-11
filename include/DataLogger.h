#pragma once

#include <Arduino.h>
#include "IncubatorTypes.h"

class DataLogger {
public:
  DataLogger(uint8_t csPin, const char* logPath);

  void begin();
  bool isReady() const;
  String statusText() const;
  void logReading(
    const String& timestamp,
    const SensorReading& reading,
    const ControlSettings& settings,
    const EggTurningMetrics& turningMetrics,
    bool bulb1On,
    bool bulb2On,
    bool fanOn,
    bool turnerOn
  );

private:
  String csvHeader() const;
  void writeHeaderIfNeeded();

  uint8_t _csPin;
  const char* _logPath;
  bool _ready = false;
};
