#include "RealTimeClock.h"
#include "Calendar.h"
#include <Wire.h>

RealTimeClock::RealTimeClock(uint8_t address) : _address(address) {}
void RealTimeClock::begin() {
  Wire.beginTransmission(_address); _ready = Wire.endTransmission() == 0;
  _pollMs = millis() - 1000; update();
}
bool RealTimeClock::readRegisters(uint8_t reg, uint8_t* bytes, uint8_t count) const {
  Wire.beginTransmission(_address); Wire.write(reg);
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(_address, count) != count) return false;
  for (uint8_t i = 0; i < count; ++i) bytes[i] = Wire.read();
  return true;
}
bool RealTimeClock::readDate(DateTimeValue& v, uint32_t& stamp) const {
  uint8_t r[7], status;
  if (!readRegisters(0, r, 7) || !readRegisters(0x0F, &status, 1) || (status & 0x80)) return false;
  if ((r[0] & 0x80) || (r[1] & 0x80) || (r[2] & 0xC0) ||
      (r[4] & 0xC0) || (r[5] & 0xE0) || r[3] < 1 || r[3] > 7) return false;
  for (uint8_t i = 0; i < 7; ++i) if ((r[i] & 15) > 9 || (r[i] >> 4) > 9) return false;
  v.year = 2000 + bcdToDecimal(r[6]); v.month = bcdToDecimal(r[5]);
  v.day = bcdToDecimal(r[4]); v.hour = bcdToDecimal(r[2]);
  v.minute = bcdToDecimal(r[1]); v.second = bcdToDecimal(r[0]);
  stamp = HatchCalendar::epoch(v.year, v.month, v.day, v.hour, v.minute, v.second);
  v.valid = stamp != 0; return v.valid;
}
void RealTimeClock::update() {
  const uint32_t nowMs = millis();
  if (uint32_t(nowMs - _pollMs) < 1000) return;
  _pollMs = nowMs;
  uint8_t status;
  if (!readRegisters(0x0F, &status, 1)) { _ready=false; _cached.valid = false; _good = 0; return; }
  _ready = true; _lostPower = (status & 0x80) != 0;
  DateTimeValue current; uint32_t stamp;
  if (_lostPower) { _cached.valid = false; _good = 0; return; }
  if (!readDate(current, stamp)) {
    if (_bad < 3) ++_bad;
    if (_bad >= 3) _needsSet = true;
    _cached.valid = false; _good = 0; return;
  }
  _bad = 0;
  if (_seen && (stamp < _epoch || stamp - _epoch > uint32_t(nowMs - _lastReadMs) / 1000 + 3))
    _needsSet = true;
  if (!_seen || stamp != _epoch) _changedMs = nowMs;
  if (uint32_t(nowMs - _changedMs) > 3500) _needsSet = true;
  _seen = true; _epoch = stamp; _lastReadMs = nowMs; _cached = current;
  if (_good < 3) ++_good;
  _cached.valid = _good >= 3 && !_needsSet;
}
bool RealTimeClock::isReady() const { return now().valid; }
bool RealTimeClock::lostPower() const { return _lostPower; }
DateTimeValue RealTimeClock::now() const {
  DateTimeValue value = _cached;
  value.valid = value.valid && uint32_t(millis() - _pollMs) <= 2500;
  return value;
}
uint32_t RealTimeClock::epoch() const { return isReady() ? _epoch : 0; }
String RealTimeClock::statusText() const {
  if (!_ready) return "Not detected";
  if (_lostPower || _needsSet) return "Waiting for automatic clock sync";
  return isReady() ? "Ready" : "Validating / read failed";
}
bool RealTimeClock::setIsoTime(const String& iso) {
  if (iso.length() != 19 || iso[4] != '-' || iso[7] != '-' || iso[10] != 'T' ||
      iso[13] != ':' || iso[16] != ':') return false;
  for (uint8_t i = 0; i < 19; ++i) {
    if (i == 4 || i == 7 || i == 10 || i == 13 || i == 16) continue;
    if (iso[i] < '0' || iso[i] > '9') return false;
  }
  const uint16_t y = iso.substring(0,4).toInt();
  const uint8_t m = iso.substring(5,7).toInt(), d = iso.substring(8,10).toInt();
  const uint8_t h = iso.substring(11,13).toInt(), n = iso.substring(14,16).toInt();
  const uint8_t s = iso.substring(17,19).toInt();
  const uint32_t wanted = HatchCalendar::epoch(y,m,d,h,n,s);
  if (!wanted) return false;
  Wire.beginTransmission(_address); Wire.write(0);
  Wire.write(decimalToBcd(s)); Wire.write(decimalToBcd(n)); Wire.write(decimalToBcd(h));
  Wire.write(1); Wire.write(decimalToBcd(d)); Wire.write(decimalToBcd(m)); Wire.write(decimalToBcd(y-2000));
  if (Wire.endTransmission() != 0) return false;
  uint8_t status;
  if (!readRegisters(0x0F, &status, 1)) return false;
  Wire.beginTransmission(_address); Wire.write(0x0F); Wire.write(status & 0x7F);
  if (Wire.endTransmission() != 0) return false;
  DateTimeValue check; uint32_t stamp;
  if (!readDate(check, stamp) || stamp < wanted || stamp - wanted > 1) return false;
  _ready = true; _lostPower = _needsSet = _seen = false; _good = _bad = 0; _cached.valid = false;
  _pollMs = millis() - 1000; return true;
}
String RealTimeClock::timestamp() const {
  const DateTimeValue v = now();
  if (!v.valid) return "RTC unavailable";
  return String(v.year) + "-" + twoDigits(v.month) + "-" + twoDigits(v.day) + " " +
    twoDigits(v.hour) + ":" + twoDigits(v.minute) + ":" + twoDigits(v.second);
}
String RealTimeClock::shortTime() const {
  const DateTimeValue v = now(); return v.valid ? twoDigits(v.hour) + ":" + twoDigits(v.minute) : "--:--";
}
uint8_t RealTimeClock::bcdToDecimal(uint8_t v) const { return (v >> 4) * 10 + (v & 15); }
uint8_t RealTimeClock::decimalToBcd(uint8_t v) const { return ((v / 10) << 4) | (v % 10); }
String RealTimeClock::twoDigits(uint8_t v) const { return (v < 10 ? String("0") : String("")) + String(v); }
