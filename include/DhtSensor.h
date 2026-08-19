#pragma once

#include <Arduino.h>
#include "Config.h"

struct SensorReading {
  float temperatureC = NAN;
  float humidityPercent = NAN;
  bool valid = false;
  uint32_t timestampMs = 0;
  String error = "No reading yet";
};

class DhtSensor {
public:
  DhtSensor(uint8_t pin, HatchConfig::SensorModel model);

  void begin();
  SensorReading read();
  SensorReading latest() const;
  bool hasValidReading() const;

private:
  SensorReading readOnce();
  bool waitForLevel(uint8_t level, uint32_t timeoutMicros) const;
  bool parseData(const uint8_t data[5], SensorReading& reading) const;

  uint8_t _pin;
  HatchConfig::SensorModel _model;
  SensorReading _latest;
};
