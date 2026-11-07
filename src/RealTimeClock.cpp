#include "RealTimeClock.h"
#include "Calendar.h"
#include <Wire.h>
#include <time.h>
#include <esp_sntp.h>
#include "Config.h"

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
  stamp=HatchRtc::decode(r);
  if(!stamp) return false;
  v.year = 2000 + bcdToDecimal(r[6]); v.month = bcdToDecimal(r[5]);
  v.day = bcdToDecimal(r[4]); v.hour = HatchRtc::hour(r[2]);
  v.minute = bcdToDecimal(r[1]); v.second = bcdToDecimal(r[0]);
  v.valid = stamp != 0; return v.valid;
}
void RealTimeClock::update() {
  const uint32_t nowMs = millis();
  if (uint32_t(nowMs - _pollMs) < 1000) return;
  _pollMs = nowMs;
  uint8_t status;
  if(sntp_get_sync_status()==SNTP_SYNC_STATUS_COMPLETED) _networkTimeTrusted=true;
  if (!readRegisters(0x0F, &status, 1)) { _ready=false; _cached.valid=false; _progress.fail(); return; }
  const bool previouslyLost=_lostPower;
  _ready = true; _lostPower = (status & 0x80) != 0;
  if(_lostPower && !previouslyLost) Serial.println("[RTC] Oscillator-stop flag set; waiting for network/browser time. Check backup battery if this repeats after power OFF.");
  if(!_oscillatorConfigured && !enableOscillator()) { _cached.valid=false; _progress.fail(); return; }
  DateTimeValue current; uint32_t stamp;
  if (_lostPower) { _cached.valid=false; _progress.requireSync(); tryNetworkSync(); return; }
  if (!readDate(current, stamp)) {
    _progress.fail(); _needsSet=_progress.needsSync();
    _cached.valid=false; tryNetworkSync(); return;
  }
  current.valid=_progress.accept(millis(),stamp); _needsSet=_progress.needsSync();
  if(current.valid) _epoch=stamp;
  const bool wasValid=_cached.valid;
  _cached=current;
  if(current.valid && !wasValid) Serial.println("[RTC] Clock validated; ready without browser login");
  if(_needsSet) tryNetworkSync();
}
bool RealTimeClock::enableOscillator() {
  uint8_t control;
  if(!readRegisters(0x0e,&control,1)) return false;
  if(control&0x80) {
    Wire.beginTransmission(_address); Wire.write(0x0e); Wire.write(control&0x7f);
    if(Wire.endTransmission()!=0 || !readRegisters(0x0e,&control,1) || (control&0x80)) return false;
    Serial.println("RTC backup oscillator enabled; lost-time flag still requires a trusted time source");
  }
  _oscillatorConfigured=true; return true;
}
void RealTimeClock::tryNetworkSync() {
  const uint32_t nowMs=millis();
  if(!_networkTimeTrusted || (_networkSetAttempted && uint32_t(nowMs-_lastNetworkSetMs)<30000)) return;
  const time_t utc=time(nullptr);
  if(utc<1704067200) return;
  const time_t local=utc+HatchConfig::ClockUtcOffsetSeconds;
  struct tm value={};
  if(!gmtime_r(&local,&value) || !HatchCalendar::valid(value.tm_year+1900,value.tm_mon+1,value.tm_mday,value.tm_hour,value.tm_min,value.tm_sec)) return;
  char iso[24]; snprintf(iso,sizeof(iso),"%04d-%02d-%02dT%02d:%02d:%02d",value.tm_year+1900,value.tm_mon+1,value.tm_mday,value.tm_hour,value.tm_min,value.tm_sec);
  _networkSetAttempted=true; _lastNetworkSetMs=nowMs;
  if(setIsoTime(iso)) Serial.println("RTC time restored automatically from network (Asia/Manila)");
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
  _ready = true; _lostPower = _needsSet = false; _progress.reset(); _cached.valid = false;
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
