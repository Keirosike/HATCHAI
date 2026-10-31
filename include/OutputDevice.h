#pragma once

#include <Arduino.h>

class OutputDevice {
public:
  OutputDevice(uint8_t pin, bool activeHigh, const char* name);

  void begin();
  void set(bool on);
  bool isOn() const;
  uint8_t pin() const;
  const char* name() const;

private:
  uint8_t outputLevel(bool on) const;

  uint8_t _pin;
  bool _activeHigh;
  const char* _name;
  bool _on = false;
};
