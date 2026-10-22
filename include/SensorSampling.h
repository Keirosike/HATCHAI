#pragma once
#include "Config.h"

// Use real attempts, not retained reading validity, to choose the next interval.
class SensorSampling {
public:
  constexpr bool due(uint32_t now) const {
    return !attempted || uint32_t(now - lastAttemptMs) >=
      (lastValid ? HatchConfig::SensorReadIntervalMs : HatchConfig::SensorRetryIntervalMs);
  }
#if __cplusplus >= 201402L
  constexpr
#endif
  void completed(uint32_t now, bool valid) {
    attempted = true; lastAttemptMs = now; lastValid = valid;
  }
private:
  bool attempted = false, lastValid = false;
  uint32_t lastAttemptMs = 0;
};
static_assert(HatchConfig::SensorRetryIntervalMs >= 2000,
  "Sensor retries must remain spaced apart");
