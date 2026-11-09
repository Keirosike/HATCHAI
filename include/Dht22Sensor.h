#pragma once
#include <Arduino.h>
#include "IncubatorTypes.h"

class Dht22Sensor {
public:
  explicit Dht22Sensor(uint8_t pin):_pin(pin) {}
  void begin();
  SensorReading read();
  SensorReading latest() const { return _latest; }
  bool hasValidReading() const { return _latest.valid; }
private:
  uint8_t _pin;
  bool _initialized=false,_attempted=false;
  uint32_t _startedMs=0,_lastAttemptMs=0;
  SensorReading _latest;
};
