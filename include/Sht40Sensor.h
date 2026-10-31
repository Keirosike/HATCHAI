#pragma once
#include <Arduino.h>
#include <Wire.h>
#include "IncubatorTypes.h"

class Sht40Sensor {
public:
  explicit Sht40Sensor(uint8_t address);
  void begin();
  SensorReading read();
  SensorReading latest() const;
  bool hasValidReading() const;
private:
  uint8_t _address;
  bool _initialized=false;
  uint32_t _startedMs=0;
  SensorReading _latest;
};
