// Actual production retry scheduler; compiler checks without any hardware.
#include "SensorSampling.h"
#include "ThermalSafety.h"
constexpr bool retryTiming() {
  SensorSampling s;
  if (!s.due(0)) return false;
  s.completed(10, false);
  if (s.due(2109) || !s.due(2110)) return false;
  s.completed(2120, true);
  if (s.due(7119) || !s.due(7120)) return false;
  s.completed(7130, false);
  if (s.due(9229) || !s.due(9230)) return false;
  s.completed(0xfffffff0U, false);
  return !s.due(uint32_t(0xfffffff0U + 2099U)) && s.due(uint32_t(0xfffffff0U + 2100U));
}
static_assert(retryTiming(), "Startup/fault retries, normal cadence and millis rollover");
constexpr bool faultsRemainBounded() {
  ThermalSafety s;
  s.sample(0,true,37); s.sample(5000,true,37); s.sample(10000,true,37);
  for (uint32_t t=12100;t<=28900;t+=2100) {
    s.sample(t,false,0);
    if (!s.ready(t) || s.sampleMs!=10000) return false;
  }
  s.update(30001,0);
  if (s.ready(30001)) return false;
  s.sample(31000,true,37); s.sample(36000,true,37); s.sample(41000,true,37);
  if (!s.heatAllowed(41000)) return false;
  s.sample(43100,false,39);
  return s.critical && !s.heatAllowed(43100);
}
static_assert(faultsRemainBounded(), "Retries never renew stale data or suppress raw critical temperature");
