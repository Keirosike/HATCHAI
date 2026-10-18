#pragma once

#include <Arduino.h>
#include <DHT.h>
#include "IncubatorTypes.h"

class Dht22Sensor {
public:
  explicit Dht22Sensor(uint8_t pin);

  void begin();
  SensorReading read();
  SensorReading latest() const;
  bool hasValidReading() const;

private:
  DHT _dht;
  bool _initialized = false;
  uint32_t _startedMs = 0;
  SensorReading _latest;
};
