#pragma once

#include <Arduino.h>
#include "IncubatorTypes.h"
#include "IncubatorTypes.h"

class LcdStatusDisplay {
public:
  LcdStatusDisplay(uint8_t address, uint8_t columns, uint8_t rows);

  void begin();
  bool isReady() const;
  String statusText() const;
  void showBoot(const String& message);
  void showStatus(
    const SensorReading& reading,
    bool turnerOn,
    const String& hatchDateText
  );

private:
  void send(uint8_t value, uint8_t mode);
  void write4Bits(uint8_t value);
  void pulseEnable(uint8_t value);
  void command(uint8_t value);
  void writeChar(char value);
  void setCursor(uint8_t column, uint8_t row);
  void printLine(uint8_t row, const String& text);
  String fit(const String& text) const;

  uint8_t _address;
  uint8_t _columns;
  uint8_t _rows;
  bool _ready = false;
  bool _backlight = true;
};
