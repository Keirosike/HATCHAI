#pragma once

#include <Arduino.h>
#include "RtcValidation.h"

struct DateTimeValue {
  uint16_t year = 2000;
  uint8_t month = 1;
  uint8_t day = 1;
  uint8_t hour = 0;
  uint8_t minute = 0;
  uint8_t second = 0;
  bool valid = false;
};

class RealTimeClock {
public:
  explicit RealTimeClock(uint8_t address);

  void begin();
  void update();
  bool setIsoTime(const String& iso);
  uint32_t epoch() const;
  bool isReady() const;
  bool lostPower() const;
  bool needsSync() const { return _ready && (_lostPower || _needsSet); }
  String statusText() const;
  DateTimeValue now() const;
  String timestamp() const;
  String shortTime() const;

private:
  uint8_t bcdToDecimal(uint8_t value) const;
  uint8_t decimalToBcd(uint8_t value) const;
  bool readRegisters(uint8_t reg, uint8_t* bytes, uint8_t count) const;
  bool readDate(DateTimeValue& value, uint32_t& epoch) const;
  bool enableOscillator();
  void tryNetworkSync();
  String twoDigits(uint8_t value) const;

  uint8_t _address;
  bool _ready = false;
  bool _lostPower = false;
  bool _needsSet=false,_oscillatorConfigured=false,_networkTimeTrusted=false,_networkSetAttempted=false;
  uint32_t _pollMs=0,_epoch=0,_lastNetworkSetMs=0;
  HatchRtc::Progress _progress;
  DateTimeValue _cached;
};
