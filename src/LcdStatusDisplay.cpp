#include "LcdStatusDisplay.h"
#include <Wire.h>

namespace {
constexpr uint8_t LcdRs = 0x01;
constexpr uint8_t LcdEnable = 0x04;
constexpr uint8_t LcdBacklight = 0x08;

constexpr uint8_t LcdClearDisplay = 0x01;
constexpr uint8_t LcdEntryModeSet = 0x04;
constexpr uint8_t LcdDisplayControl = 0x08;
constexpr uint8_t LcdFunctionSet = 0x20;
constexpr uint8_t LcdSetDdramAddress = 0x80;
}

LcdStatusDisplay::LcdStatusDisplay(uint8_t address, uint8_t columns, uint8_t rows)
  : _address(address), _columns(columns), _rows(rows) {}

void LcdStatusDisplay::begin() {
  Wire.beginTransmission(_address);
  _ready = Wire.endTransmission() == 0;

  if (!_ready) {
    Serial.println("LCD I2C not detected");
    return;
  }

  delay(50);
  write4Bits(0x30);
  delayMicroseconds(4500);
  write4Bits(0x30);
  delayMicroseconds(4500);
  write4Bits(0x30);
  delayMicroseconds(150);
  write4Bits(0x20);

  command(LcdFunctionSet | 0x08);
  command(LcdDisplayControl | 0x04);
  command(LcdClearDisplay);
  delayMicroseconds(2000);
  command(LcdEntryModeSet | 0x02);

  showBoot("HatchAI booting");
  Serial.println("LCD I2C ready");
}

bool LcdStatusDisplay::isReady() const {
  return _ready;
}

String LcdStatusDisplay::statusText() const {
  Wire.beginTransmission(_address);
  return Wire.endTransmission()==0 ? "I2C responding" : "Not detected";
}

void LcdStatusDisplay::showBoot(const String& message) {
  if (!_ready) {
    return;
  }

  printLine(0, "HatchAI Incubator");
  printLine(1, message);
  printLine(2, "Sensor starting");
  printLine(3, "Prediction ready");
}

void LcdStatusDisplay::showStatus(
  const SensorReading& reading,
  bool turnerOn,
  const String& hatchDateText,
  const String& alarmText,
  const String& batchDays
) {
  if (!_ready) {
    return;
  }

  String readings="T:--.-C RH:--%";
  if (reading.valid) readings="T:"+String(reading.temperatureC,1)+"C RH:"+String(reading.humidityPercent,0)+"%";
  printLine(0,readings);
  printLine(1,batchDays.length() ? batchDays : "No batch on rollers");
  printLine(2,hatchDateText.length() ? hatchDateText : "Est: unavailable");
  printLine(3,alarmText.length() ? alarmText : turnerOn ? "Egg turn: ON" : "Egg turn: OFF");
}

void LcdStatusDisplay::send(uint8_t value, uint8_t mode) {
  write4Bits((value & 0xF0) | mode);
  write4Bits(((value << 4) & 0xF0) | mode);
}

void LcdStatusDisplay::write4Bits(uint8_t value) {
  const uint8_t backlight = _backlight ? LcdBacklight : 0;

  Wire.beginTransmission(_address);
  Wire.write(static_cast<uint8_t>(value | backlight));
  Wire.endTransmission();

  pulseEnable(value | backlight);
}

void LcdStatusDisplay::pulseEnable(uint8_t value) {
  Wire.beginTransmission(_address);
  Wire.write(static_cast<uint8_t>(value | LcdEnable));
  Wire.endTransmission();
  delayMicroseconds(1);

  Wire.beginTransmission(_address);
  Wire.write(static_cast<uint8_t>(value & ~LcdEnable));
  Wire.endTransmission();
  delayMicroseconds(50);
}

void LcdStatusDisplay::command(uint8_t value) {
  send(value, 0);
}

void LcdStatusDisplay::writeChar(char value) {
  send(static_cast<uint8_t>(value), LcdRs);
}

void LcdStatusDisplay::setCursor(uint8_t column, uint8_t row) {
  static const uint8_t rowOffsets[] = {0x00, 0x40, 0x14, 0x54};

  if (row >= _rows) {
    row = _rows - 1;
  }

  command(LcdSetDdramAddress | (column + rowOffsets[row]));
}

void LcdStatusDisplay::printLine(uint8_t row, const String& text) {
  if (row >= _rows) {
    return;
  }

  const String line = fit(text);
  setCursor(0, row);

  for (uint8_t i = 0; i < _columns; i++) {
    writeChar(line[i]);
  }
}

String LcdStatusDisplay::fit(const String& text) const {
  String line = text;

  if (line.length() > _columns) {
    line = line.substring(0, _columns);
  }

  while (line.length() < _columns) {
    line += " ";
  }

  return line;
}
