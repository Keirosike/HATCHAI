#pragma once
#include <stdint.h>
namespace HatchPairing {
// Inject UTC system seconds and monotonic milliseconds, never local RTC seconds.
// Synchronization provenance is the caller's responsibility; this is not NTP authentication.
class NotificationUtcClock {
public:
  static constexpr uint64_t MinimumUtc=1704067200ULL; // 2024-01-01
  static constexpr uint64_t MaximumUtc=4102444800ULL; // 2100-01-01, exclusive
  static constexpr uint64_t FreshnessMs=86400000ULL;
  bool synchronize(uint64_t utc,uint32_t now);
  bool valid(uint64_t utc,uint32_t now);
  void reset(){synced_=false;fault_=false;age_=0;}
private:
  bool synced_=false,fault_=false;
  uint64_t baseline_=0,age_=0;uint32_t last_=0;
  bool observe(uint64_t utc,uint32_t now);
};
}
