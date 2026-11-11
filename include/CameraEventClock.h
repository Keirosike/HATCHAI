#pragma once
#include <stdint.h>
namespace HatchCameraClock {
// Use monotonic 64-bit uptime so clock freshness cannot revive after millis
// wraps.
inline uint32_t utcAt(uint32_t utc, uint64_t anchor, uint64_t captured,
                      uint64_t current) {
  if (utc < 1704067200U || utc >= 4102444800U || current < anchor ||
      current - anchor >= 21600000ULL || captured > current)
    return 0;
  const int64_t value =
      int64_t(utc) + (int64_t(captured) - int64_t(anchor)) / 1000;
  return value >= 1704067200LL && value < 4102444800LL ? uint32_t(value) : 0;
}
// Persisted legacy-width capture counters are ambiguous after one full wrap.
inline bool age(uint32_t boot, uint32_t capturedBoot, uint64_t current,
                uint32_t captured, uint32_t &value) {
  value = 0;
  if (boot != capturedBoot || current > UINT32_MAX || current < captured)
    return false;
  value = uint32_t(current) - captured;
  return true;
}
} // namespace HatchCameraClock
