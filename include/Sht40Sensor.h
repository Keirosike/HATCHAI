#pragma once

#include <Arduino.h>
#include "IncubatorTypes.h"

class Sht40Sensor {
public:
  explicit Sht40Sensor(uint8_t address);

  void begin();
  SensorReading read();
  SensorReading latest() const;
  bool hasValidReading() const;

private:
  SensorReading readOnce();
  bool probe();
  uint8_t calculateCrc(const uint8_t* data, size_t length) const;

  uint8_t _address;
  bool _ready = false;
  SensorReading _latest;
};
