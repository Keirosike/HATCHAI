#pragma once
#include <Arduino.h>
#include "IncubatorTypes.h"
#ifdef ARDUINO_ARCH_ESP32
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#endif

class Dht22Sensor {
public:
  explicit Dht22Sensor(uint8_t pin):_pin(pin) {}
  void begin();
  SensorReading read();
  SensorReading latest() const;
  bool startAcquisition();
  SensorReading acquisition() const;
  bool hasValidReading() const { return latest().valid; }
private:
  uint8_t _pin;
  bool _initialized=false,_attempted=false;
  uint32_t _startedMs=0,_lastAttemptMs=0;
  SensorReading _latest;
#ifdef ARDUINO_ARCH_ESP32
  struct Frame {float temperature,humidity;uint32_t at;uint8_t valid,error;};
  QueueHandle_t attempts_=nullptr,valid_=nullptr;
  static void task(void*);
  static SensorReading reading(const Frame&);
#endif
};
