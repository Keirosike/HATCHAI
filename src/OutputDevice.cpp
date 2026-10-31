#include "OutputDevice.h"

OutputDevice::OutputDevice(uint8_t pin, bool activeHigh, const char* name)
  : _pin(pin), _activeHigh(activeHigh), _name(name) {}

void OutputDevice::begin() {
  digitalWrite(_pin, outputLevel(false));
  pinMode(_pin, OUTPUT);
  set(false);
  Serial.printf("Relay %s: GPIO %u, active-%s, initialized OFF\n",
    _name, static_cast<unsigned int>(_pin), _activeHigh ? "HIGH" : "LOW");
}

void OutputDevice::set(bool on) {
  _on = on;
  digitalWrite(_pin, outputLevel(on));
}

bool OutputDevice::isOn() const {
  return _on;
}

uint8_t OutputDevice::pin() const {
  return _pin;
}

const char* OutputDevice::name() const {
  return _name;
}

uint8_t OutputDevice::outputLevel(bool on) const {
  const bool high = _activeHigh ? on : !on;
  return high ? HIGH : LOW;
}
