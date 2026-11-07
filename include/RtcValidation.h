#pragma once
#include "Calendar.h"
#if __cplusplus >= 201402L
#define HATCH_RTC_CX constexpr
#else
#define HATCH_RTC_CX inline
#endif
namespace HatchRtc {
constexpr bool bcd(uint8_t x) { return (x&15)<=9 && (x>>4)<=9; }
constexpr uint8_t decimal(uint8_t x) { return (x>>4)*10+(x&15); }
HATCH_RTC_CX int hour(uint8_t x) {
  if(x&0x80) return -1;
  if(x&0x40) {
    const uint8_t h=x&0x1f;
    return bcd(h) && decimal(h)>=1 && decimal(h)<=12 ? decimal(h)%12+((x&0x20)?12:0) : -1;
  }
  return bcd(x) && decimal(x)<24 ? decimal(x) : -1;
}
HATCH_RTC_CX uint32_t decode(const uint8_t* r) {
  if(!bcd(r[0]) || decimal(r[0])>=60 || !bcd(r[1]) || decimal(r[1])>=60 || hour(r[2])<0 ||
      r[3]<1 || r[3]>7 || !bcd(r[4]) || !bcd(r[5]) || (r[5]&0x80) || !bcd(r[6])) return 0;
  return HatchCalendar::epoch(2000+decimal(r[6]),decimal(r[5]),decimal(r[4]),hour(r[2]),decimal(r[1]),decimal(r[0]));
}
// Keep the last trusted time separate from untrusted frames. A bad read/jump
// cannot poison the baseline or permanently latch a healthy, advancing RTC OFF.
class Progress {
public:
  HATCH_RTC_CX void reset() { *this=Progress(); }
  HATCH_RTC_CX void fail() { _ready=false; _good=0; _advanced=false; if(_bad<3) ++_bad; if(_bad>=3) _needsSync=true; }
  HATCH_RTC_CX void requireSync() { fail(); _needsSync=true; }
  HATCH_RTC_CX bool accept(uint32_t now,uint32_t stamp) {
    if(!HatchCalendar::validEpoch(stamp)) { fail(); return false; }
    const uint32_t elapsed=(now-_trustedMs)/1000;
    if(_trusted && (stamp<_epoch || stamp-_epoch>elapsed+3 || elapsed>stamp-_epoch+3)) {
      fail(); _needsSync=true; return false;
    }
    if(_seen && (stamp<_candidate || stamp-_candidate>uint32_t(now-_candidateMs)/1000+3)) {
      fail(); if(!_trusted) _seen=false; return false;
    }
    if(!_seen || stamp!=_candidate) { _changedMs=now; _advanced=_seen; }
    if(_seen && uint32_t(now-_changedMs)>3500) { requireSync(); return false; }
    _seen=true; _candidate=stamp; _candidateMs=now; _bad=0;
    if(_good<3) ++_good;
    _ready=_good>=3 && _advanced;
    if(_ready) { _epoch=stamp; _trustedMs=now; _trusted=true; _needsSync=false; }
    return _ready;
  }
  constexpr bool needsSync() const { return _needsSync; }
private:
  bool _ready=false,_trusted=false,_seen=false,_advanced=false,_needsSync=false;
  uint8_t _good=0,_bad=0;
  uint32_t _epoch=0,_trustedMs=0,_candidate=0,_candidateMs=0,_changedMs=0;
};
}
#undef HATCH_RTC_CX
