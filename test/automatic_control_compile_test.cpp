// Compiler evaluates actual production safety state; no board or actuators.
#include "ThermalSafety.h"
#include "Calendar.h"
#include "TurnSchedule.h"
constexpr bool recoveryAndStale() {
  ThermalSafety s;
  s.sample(0, true, 37); s.sample(2000, true, 37);
  if (s.ready(2000)) return false;
  s.sample(4000, true, 37);
  if (!s.heatAllowed(4000) || !s.ready(24000)) return false;
  s.update(24001, 0);
  if (s.ready(24001)) return false;
  s.sample(26000, true, 37); s.sample(31000, true, 37); s.sample(36000, true, 37);
  if (!s.ready(36000)) return false;
  s.sample(41000, false, 37);
  if (!s.heatAllowed(41000) || s.sampleMs != 36000) return false;
  s.sample(56001, false, 37);
  return !s.heatAllowed(56001);
}
static_assert(recoveryAndStale(), "Three valid stable readings, transient failures retained, stale hold");
constexpr bool temperatureBoundaries() {
  ThermalSafety s;
  s.sample(0, true, 38);
  if (s.inhibited) return false;
  s.sample(2000, true, 38.1f);
  if (!s.inhibited) return false;
  s.sample(4000, true, 37.6f);
  if (!s.inhibited) return false;
  s.sample(6000, true, 37.5f);
  if (s.inhibited) return false;
  s.sample(8000, true, 38.5f);
  if (!s.high || s.critical) return false;
  s.sample(10000, false, 39); // valid raw temperature must trip even if humidity fails
  if (!s.critical || s.acknowledge(10000)) return false;
  s.sample(12000, true, 37); s.sample(14000, true, 37); s.sample(16000, true, 37);
  return s.critical && s.acknowledge(16000) && !s.critical;
}
static_assert(temperatureBoundaries(), "Unfiltered trips, threshold equality, hysteresis and deliberate ACK");
constexpr bool lowWarning() {
  ThermalSafety s;
  for (uint32_t t = 0; t <= 2400000; t += 2000) {
    s.sample(t, true, 36); s.update(t, 0);
    if (t < 2400000 && s.low) return false;
  }
  if (!s.low) return false;
  s.sample(2402000, true, 36.6f); s.update(2402000, 0);
  s.sample(2404000, true, 37); s.update(2404000, 0);
  return !s.low;
}
static_assert(lowWarning(), "30-minute warmup and 10-minute low warning delay");
constexpr bool warmupDoesNotRepeatAfterRollover() {
  ThermalSafety s;
  s.update(HatchConfig::LowWarningWarmupMs, 0);
  s.update(1000, 0); // uptime has wrapped after long continuous operation
  s.sample(1000, true, 36); s.sample(3000, true, 36); s.sample(5000, true, 36);
  s.update(5000, 0);
  return s.ready(5000) && s.lowTiming;
}
static_assert(warmupDoesNotRepeatAfterRollover(), "Boot warmup is one-shot across millis rollover");
static_assert(HatchCalendar::epoch(2024,1,1) == 1704067200UL, "RTC epoch baseline");
static_assert(HatchCalendar::valid(2024,2,29,0,0,0), "Leap date");
static_assert(!HatchCalendar::valid(2025,2,29,0,0,0) && !HatchCalendar::valid(2026,13,1,0,0,0), "Reject invalid calendar fields");
constexpr uint32_t Start = 1800000000UL;
static_assert(!HatchTurning::due(Start+7199, Start, Start,120) &&
  HatchTurning::due(Start+7200, Start, Start,120), "RTC two-hour boundary");
static_assert(!HatchTurning::due(Start+7201, Start, Start+7200,120), "Persisted reservation prevents repeat after reset");
static_assert(!HatchTurning::ageAllowed(Start+17UL*86400,Start,Start), "Lockdown at the start of chicken day 18");
static_assert(!HatchTurning::ageAllowed(Start-1,Start,Start) &&
  !HatchTurning::due(0,Start,Start,120), "No uptime fallback / backward date turning");
static_assert(!HatchTurning::canStart(true,5000,0) && !HatchTurning::canStart(false,999,0) &&
  HatchTurning::canStart(false,1000,0), "Per-roller restart gap and no restart of an already active motor");
static_assert(HatchTurning::canStart(false,5000,4000) && !HatchTurning::canStart(false,5000,4500),
  "Each roller uses its own OFF timestamp");

constexpr bool qualifyOnlyOnRecovery() {
  ThermalSafety s;
  s.sample(0,true,36); s.sample(5000,true,36.8f); s.sample(10000,true,37.4f);
  if (s.ready(10000)) return false; // startup still needs stable frames
  s.sample(15000,true,37.4f); s.sample(20000,true,37.4f);
  if (!s.ready(20000)) return false;
  s.sample(25000,true,36.7f);
  if (!s.ready(25000)) return false;
  s.update(45001,0);
  if (s.ready(45001)) return false;
  s.sample(46000,true,37.1f); s.sample(51000,true,37.1f);
  if (s.ready(51000)) return false;
  s.sample(56000,true,37.1f);
  return s.ready(56000);
}
static_assert(qualifyOnlyOnRecovery(), "Startup stability remains mandatory, stale recovery requalifies");
