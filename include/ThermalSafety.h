#pragma once
#include "Config.h"
#if __cplusplus >= 201402L
#define HATCH_SAFETY_CONSTEXPR constexpr
#else
#define HATCH_SAFETY_CONSTEXPR
#endif
class ThermalSafety {
public:
  HATCH_SAFETY_CONSTEXPR void sample(uint32_t now, bool valid, float temperature) {
    // Unfiltered calibrated temperature trips protection even when humidity fails.
    if (temperature >= -40 && temperature <= 80) {
      if (temperature > HatchConfig::HeaterInhibitC) inhibited = true;
      else if (temperature <= HatchConfig::HeaterResumeC) inhibited = false;
      if (temperature >= HatchConfig::HighTemperatureC) high = true;
      else if (temperature <= HatchConfig::HeaterInhibitC) high = false;
      if (temperature >= HatchConfig::CriticalTemperatureC) critical = true;
    }
    if (!valid || !(temperature >= -40 && temperature <= 80)) {
      // A missed frame does not refresh the timestamp or erase a fresh sample.
      if (!sensorValid || uint32_t(now - sampleMs) > HatchConfig::SensorStaleAfterMs) invalidate();
      return;
    }
    // Qualify startup/recovery, not every normal temperature change after it.
    if (!sensorValid || (good < HatchConfig::SensorRecoverySamples &&
        (temperature - lastTemperature > HatchConfig::SensorRecoveryStepC ||
         lastTemperature - temperature > HatchConfig::SensorRecoveryStepC))) good = 1;
    else if (good < HatchConfig::SensorRecoverySamples) ++good;
    filtered = sensorValid ? filtered + HatchConfig::SensorFilterAlpha *
      (temperature - filtered) : temperature;
    sensorValid = true; lastTemperature = temperature; sampleMs = now;
  }
  HATCH_SAFETY_CONSTEXPR void invalidate() { sensorValid = false; good = 0; }
  HATCH_SAFETY_CONSTEXPR void update(uint32_t now, uint32_t boot) {
    if (!warmupComplete && uint32_t(now - boot) >= HatchConfig::LowWarningWarmupMs) warmupComplete = true;
    if (sensorValid && uint32_t(now - sampleMs) > HatchConfig::SensorStaleAfterMs) invalidate();
    if (!ready(now) || !warmupComplete) {
      low = lowTiming = false; return;
    }
    if (lastTemperature >= HatchConfig::LowClearC) low = lowTiming = false;
    else if (lastTemperature < HatchConfig::LowTemperatureC) {
      if (!lowTiming) { lowTiming = true; lowSince = now; }
      if (uint32_t(now - lowSince) >= HatchConfig::LowWarningDelayMs) low = true;
    } else if (!low) lowTiming = false;
  }
  constexpr bool ready(uint32_t now) const {
    return sensorValid && good >= HatchConfig::SensorRecoverySamples &&
      uint32_t(now - sampleMs) <= HatchConfig::SensorStaleAfterMs;
  }
  // Cooling demand is smoothed; hot readings always act immediately.
  constexpr float controlTemperature() const {
    return lastTemperature > filtered ? lastTemperature : filtered;
  }
  constexpr bool heatAllowed(uint32_t now) const { return ready(now) && !inhibited && !critical; }
  HATCH_SAFETY_CONSTEXPR bool acknowledge(uint32_t now) {
    if (!ready(now) || lastTemperature > HatchConfig::HeaterResumeC) return false;
    critical = false; return true;
  }
  bool sensorValid = false, inhibited = false, high = false, critical = false;
  bool low = false, lowTiming = false, warmupComplete = false;
  uint8_t good = 0;
  uint32_t sampleMs = 0, lowSince = 0;
  float filtered = 0, lastTemperature = 0;
};
#undef HATCH_SAFETY_CONSTEXPR
