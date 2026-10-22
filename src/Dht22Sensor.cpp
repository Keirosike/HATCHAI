#include "Dht22Sensor.h"

namespace {
static_assert(HatchConfig::SensorReadIntervalMs >= 2000,
  "DHT22 requires at least two seconds between measurements");
}

Dht22Sensor::Dht22Sensor(uint8_t pin) : _dht(pin, DHT22) {}

void Dht22Sensor::begin() {
  _dht.begin();
  _startedMs = millis();
  _initialized = true;
  Serial.println("DHT22 initialized; sensor presence is checked when reading");
}

SensorReading Dht22Sensor::read() {
  SensorReading reading;
  reading.timestampMs = millis();

  if (!_initialized) {
    reading.error = "DHT22 not initialized";
    return reading;
  }

  if (reading.timestampMs - _startedMs < HatchConfig::SensorStartupMs) {
    reading.error = "DHT22 warming up";
    return reading;
  }

  // Both values use one checksum-validated frame cached by the DHT library.
  // Failed attempts are retried after 2.1 seconds by the controller, without blocking.
  reading.temperatureC = _dht.readTemperature();
  reading.humidityPercent = _dht.readHumidity();

  if (!isfinite(reading.temperatureC) || !isfinite(reading.humidityPercent)) {
    reading.error = "DHT22 read failed (timeout or checksum error)";
    return reading;
  }

  if (
    reading.temperatureC < -40.0f || reading.temperatureC > 80.0f ||
    reading.humidityPercent < 0.0f || reading.humidityPercent > 100.0f
  ) {
    reading.error = "DHT22 reading is outside expected range";
    return reading;
  }

  reading.valid = true;
  reading.error = "";
  _latest = reading;
  return reading;
}

SensorReading Dht22Sensor::latest() const {
  return _latest;
}

bool Dht22Sensor::hasValidReading() const {
  return _latest.valid;
}
