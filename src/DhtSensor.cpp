#include "DhtSensor.h"

DhtSensor::DhtSensor(uint8_t pin, HatchConfig::SensorModel model)
  : _pin(pin), _model(model) {}

void DhtSensor::begin() {
  pinMode(_pin, INPUT_PULLUP);
  digitalWrite(_pin, HIGH);
}

SensorReading DhtSensor::latest() const {
  return _latest;
}

bool DhtSensor::hasValidReading() const {
  return _latest.valid;
}

bool DhtSensor::waitForLevel(uint8_t level, uint32_t timeoutMicros) const {
  const uint32_t started = micros();

  while (digitalRead(_pin) != level) {
    if (micros() - started > timeoutMicros) {
      return false;
    }
  }

  return true;
}

SensorReading DhtSensor::read() {
  SensorReading lastReading;

  for (uint8_t attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      delay(80);
    }

    lastReading = readOnce();

    if (lastReading.valid) {
      _latest = lastReading;
      return lastReading;
    }
  }

  return lastReading;
}

SensorReading DhtSensor::readOnce() {
  SensorReading reading;
  reading.timestampMs = millis();

  uint8_t data[5] = {0, 0, 0, 0, 0};

  pinMode(_pin, OUTPUT);
  digitalWrite(_pin, LOW);
  delay(_model == HatchConfig::SensorModel::Dht11 ? 20 : 2);
  pinMode(_pin, INPUT_PULLUP);
  delayMicroseconds(40);

  noInterrupts();

  if (!waitForLevel(LOW, 160)) {
    interrupts();
    reading.error = "DHT sensor did not respond";
    return reading;
  }

  if (!waitForLevel(HIGH, 160)) {
    interrupts();
    reading.error = "DHT response low pulse timed out";
    return reading;
  }

  if (!waitForLevel(LOW, 160)) {
    interrupts();
    reading.error = "DHT response high pulse timed out";
    return reading;
  }

  for (uint8_t bitIndex = 0; bitIndex < 40; bitIndex++) {
    if (!waitForLevel(HIGH, 120)) {
      interrupts();
      reading.error = "DHT data low pulse timed out";
      return reading;
    }

    const uint32_t highStarted = micros();

    if (!waitForLevel(LOW, 180)) {
      interrupts();
      reading.error = "DHT data high pulse timed out";
      return reading;
    }

    const uint32_t highDuration = micros() - highStarted;
    data[bitIndex / 8] <<= 1;

    if (highDuration > 45) {
      data[bitIndex / 8] |= 1;
    }
  }

  interrupts();

  if (!parseData(data, reading)) {
    return reading;
  }

  return reading;
}

bool DhtSensor::parseData(const uint8_t data[5], SensorReading& reading) const {
  const uint8_t checksum = data[0] + data[1] + data[2] + data[3];

  if (checksum != data[4]) {
    reading.error = "DHT checksum mismatch";
    return false;
  }

  if (_model == HatchConfig::SensorModel::Dht11) {
    reading.humidityPercent = data[0] + (data[1] * 0.1f);
    reading.temperatureC = data[2] + ((data[3] & 0x7F) * 0.1f);

    if (data[3] & 0x80) {
      reading.temperatureC = -reading.temperatureC;
    }
  } else {
    const uint16_t rawHumidity = (static_cast<uint16_t>(data[0]) << 8) | data[1];
    const uint16_t rawTemperature =
      ((static_cast<uint16_t>(data[2] & 0x7F)) << 8) | data[3];

    reading.humidityPercent = rawHumidity * 0.1f;
    reading.temperatureC = rawTemperature * 0.1f;

    if (data[2] & 0x80) {
      reading.temperatureC = -reading.temperatureC;
    }
  }

  if (
    reading.humidityPercent < 0 ||
    reading.humidityPercent > 100 ||
    reading.temperatureC < -40 ||
    reading.temperatureC > 90
  ) {
    reading.error = "DHT reading is outside expected range";
    return false;
  }

  reading.valid = true;
  reading.error = "";
  return true;
}
