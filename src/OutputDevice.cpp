#include "OutputDevice.h"

OutputDevice::OutputDevice(int pin, bool activeHigh, const char* name)
  : _pin(pin), _activeHigh(activeHigh), _name(name) {}

void OutputDevice::begin() {
  if (_pin < 0) { _on=true; return; } // Direct-powered fan: assumed ON, not measured.
  digitalWrite(_pin, outputLevel(false));
  pinMode(_pin, OUTPUT);
  set(false);
  Serial.printf("Relay %s: GPIO %u, active-%s, initialized OFF\n",
    _name, static_cast<unsigned int>(_pin), _activeHigh ? "HIGH" : "LOW");
}

void OutputDevice::set(bool on) {
  if (_pin < 0) { _on=true; return; }
  _on = on;
  digitalWrite(_pin, outputLevel(on));
}

bool OutputDevice::isOn() const {
  return _on;
}

int OutputDevice::pin() const {
  return _pin;
}

const char* OutputDevice::name() const {
  return _name;
}

uint8_t OutputDevice::outputLevel(bool on) const {
  const bool high = _activeHigh ? on : !on;
  return high ? HIGH : LOW;
}
