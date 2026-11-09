#pragma once

#include <Arduino.h>

class OutputDevice {
public:
  OutputDevice(int pin, bool activeHigh, const char* name);

  void begin();
  void set(bool on);
  bool isOn() const;
  int pin() const;
  const char* name() const;

private:
  uint8_t outputLevel(bool on) const;

  int _pin;
  bool _activeHigh;
  const char* _name;
  bool _on = false;
};
