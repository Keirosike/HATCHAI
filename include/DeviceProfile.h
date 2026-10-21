#pragma once
#include <Preferences.h>
#include "Calendar.h"
#include "Config.h"
struct LegacyDeviceProfile {
  uint32_t magic = 0x48414932;
  uint32_t flags = 0; // bit 0 critical, bit 1 turning armed, bit 2 abnormal-reset hold
  uint32_t start[2] = {0, 0}, reserved[2] = {0, 0};
  uint16_t duration[2] = {HatchConfig::TurnerPulseMs / 1000, HatchConfig::TurnerPulseMs / 1000};
  uint16_t interval[2] = {HatchConfig::DefaultTurnIntervalMinutes, HatchConfig::DefaultTurnIntervalMinutes};
  float temperature = HatchConfig::DefaultTargetTemperatureC;
  float humidity = HatchConfig::DefaultTargetHumidityPercent, calibration = 0;
  char batchId[2][49] = {};
  uint8_t active[2] = {0, 0};
};
struct DeviceProfile : LegacyDeviceProfile {
  uint32_t turningEnd[2]={0,0};
  DeviceProfile() { magic=0x48414933; flags=16; } // bit 3 manual mode, bit 4 mode known
};
static_assert(sizeof(LegacyDeviceProfile)==144 && sizeof(DeviceProfile)==152, "Version the persisted profile schema");
class DeviceProfileStore {
public:
  void begin() {
    healthy = prefs.begin("hatchai-ctrl", false);
    if (!healthy) return;
    existed = prefs.isKey("profile");
    if (!existed) { save(); return; }
    const bool migrating=prefs.getBytesLength("profile")==sizeof(LegacyDeviceProfile);
    if(migrating) {
      LegacyDeviceProfile old;
      healthy=prefs.getBytes("profile",&old,sizeof(old))==sizeof(old) && old.magic==0x48414932;
      if(!healthy) { value=DeviceProfile(); return; }
      static_cast<LegacyDeviceProfile&>(value)=old; value.magic=0x48414933;
      // Keep an untouched copy of the previous format before migrating.
      healthy=prefs.putBytes("profile-v2",&old,sizeof(old))==sizeof(old);
    } else healthy = prefs.getBytesLength("profile") == sizeof(value) &&
      prefs.getBytes("profile", &value, sizeof(value)) == sizeof(value) &&
      value.magic == 0x48414933 && !(value.flags & ~31UL) &&
      value.temperature >= 30 && value.temperature <= 37.8f &&
      value.humidity >= 0 && value.humidity <= 100 &&
      value.calibration >= -2 && value.calibration <= 2;
    healthy=healthy && value.magic==0x48414933 && !(value.flags&~31UL) &&
      value.temperature>=30 && value.temperature<=37.8f && value.humidity>=0 && value.humidity<=100 &&
      value.calibration>=-2 && value.calibration<=2;
    for (uint8_t i = 0; i < 2 && healthy; ++i) {
      healthy = value.duration[i] >= 1 && value.duration[i] <= 600 &&
        value.interval[i] >= 30 && value.interval[i] <= 360 && value.active[i] <= 1 &&
        memchr(value.batchId[i], 0, sizeof(value.batchId[i])) &&
        (value.start[i] == 0 ? value.reserved[i] == 0 :
          HatchCalendar::validEpoch(value.start[i]) && value.reserved[i] >= value.start[i] &&
          HatchCalendar::validEpoch(value.reserved[i])) &&
        (!value.turningEnd[i] || (value.start[i] && value.turningEnd[i]>=value.start[i] &&
          value.turningEnd[i]<=value.start[i]+HatchConfig::LockdownAfterSeconds));
    }
    // Keep corrupt data on flash for service, but never expose unbounded strings
    // or non-finite fields from a malformed blob in dashboard JSON.
    if (!healthy) value = DeviceProfile();
    else if(migrating) save();
  }
  bool save() {
    if (!healthy) return false;
    DeviceProfile check;
    healthy = prefs.putBytes("profile", &value, sizeof(value)) == sizeof(value) &&
      prefs.getBytes("profile", &check, sizeof(check)) == sizeof(check) &&
      memcmp(&check, &value, sizeof(value)) == 0;
    return healthy;
  }
  DeviceProfile value;
  bool healthy = false;
  bool existed = false;
private:
  Preferences prefs;
};
