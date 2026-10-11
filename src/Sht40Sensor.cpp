#include "Sht40Sensor.h"
#include <Wire.h>

namespace {
constexpr uint8_t MeasureHighPrecisionCommand = 0xFD;
constexpr uint8_t MeasurementBytes = 6;
constexpr uint8_t MaxReadAttempts = 3;
constexpr uint32_t MeasurementDelayMs = 10;
}

Sht40Sensor::Sht40Sensor(uint8_t address) : _address(address) {}

void Sht40Sensor::begin() {
  _ready = probe();
  Serial.println(_ready ? "SHT40 sensor detected" : "SHT40 sensor not detected");
}

SensorReading Sht40Sensor::read() {
  SensorReading lastReading;

  for (uint8_t attempt = 0; attempt < MaxReadAttempts; attempt++) {
    if (attempt > 0) {
      delay(20);
    }

    lastReading = readOnce();

    if (lastReading.valid) {
      _latest = lastReading;
      return lastReading;
    }
  }

  return lastReading;
}

SensorReading Sht40Sensor::latest() const {
  return _latest;
}

bool Sht40Sensor::hasValidReading() const {
  return _latest.valid;
}

SensorReading Sht40Sensor::readOnce() {
  SensorReading reading;
  reading.timestampMs = millis();

  Wire.beginTransmission(_address);
  Wire.write(MeasureHighPrecisionCommand);

  if (Wire.endTransmission() != 0) {
    _ready = false;
    reading.error = "SHT40 sensor not detected";
    return reading;
  }

  _ready = true;
  delay(MeasurementDelayMs);

  if (Wire.requestFrom(_address, MeasurementBytes) != MeasurementBytes) {
    reading.error = "SHT40 measurement response incomplete";
    return reading;
  }

  uint8_t data[MeasurementBytes];

  for (uint8_t index = 0; index < MeasurementBytes; index++) {
    data[index] = Wire.read();
  }

  if (calculateCrc(data, 2) != data[2]) {
    reading.error = "SHT40 temperature CRC mismatch";
    return reading;
  }

  if (calculateCrc(data + 3, 2) != data[5]) {
    reading.error = "SHT40 humidity CRC mismatch";
    return reading;
  }

  const uint16_t rawTemperature =
    (static_cast<uint16_t>(data[0]) << 8) | data[1];
  const uint16_t rawHumidity =
    (static_cast<uint16_t>(data[3]) << 8) | data[4];

  reading.temperatureC = -45.0f + 175.0f * rawTemperature / 65535.0f;
  reading.humidityPercent = -6.0f + 125.0f * rawHumidity / 65535.0f;
  reading.humidityPercent = constrain(reading.humidityPercent, 0.0f, 100.0f);

  if (reading.temperatureC < -40.0f || reading.temperatureC > 125.0f) {
    reading.error = "SHT40 reading is outside expected range";
    return reading;
  }

  reading.valid = true;
  reading.error = "";
  return reading;
}

bool Sht40Sensor::probe() {
  Wire.beginTransmission(_address);
  return Wire.endTransmission() == 0;
}

uint8_t Sht40Sensor::calculateCrc(const uint8_t* data, size_t length) const {
  uint8_t crc = 0xFF;

  for (size_t index = 0; index < length; index++) {
    crc ^= data[index];

    for (uint8_t bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) ? (crc << 1) ^ 0x31 : crc << 1;
    }
  }

  return crc;
}
