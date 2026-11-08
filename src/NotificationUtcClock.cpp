#include "NotificationUtcClock.h"
namespace HatchPairing {
bool NotificationUtcClock::observe(uint64_t utc,uint32_t now){
  if(!synced_||fault_)return false;
  age_+=uint32_t(now-last_);last_=now;
  if(utc<MinimumUtc||utc>=MaximumUtc){fault_=true;return false;}
  const uint64_t expected=baseline_+age_/1000;
  const uint64_t difference=utc>expected?utc-expected:expected-utc;
  if(difference>5){fault_=true;return false;}
  return true;
}
bool NotificationUtcClock::synchronize(uint64_t utc,uint32_t now){
  if(fault_||utc<MinimumUtc||utc>=MaximumUtc)return false;
  if(synced_&&!observe(utc,now))return false;
  baseline_=utc;last_=now;age_=0;synced_=true;return true;
}
bool NotificationUtcClock::valid(uint64_t utc,uint32_t now){return observe(utc,now)&&age_<FreshnessMs;}
}
