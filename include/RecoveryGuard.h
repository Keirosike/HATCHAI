#pragma once
#include <Preferences.h>
#include "RecoveryState.h"

// Small NVS intent journal protects against fallback to a stale-but-valid SD
// snapshot. A motor intent is durable before either PENDING or relay ON.
class RecoveryGuard {
public:
  struct Value {
    uint32_t version, serial[2], lastRtc, sequenceCeiling;
    uint16_t periodDays[2];
    uint8_t batchStatus[2], uncertainMask, initialized;
    uint32_t crc;
  } value = {};
  bool healthy=false,existed=false;
  void begin() {
    healthy=prefs.begin("hatchai-rec",false); if(!healthy) return;
    existed=prefs.isKey("guard");
    if(!existed) { value.version=1; value.periodDays[0]=value.periodDays[1]=HatchConfig::DefaultIncubationDays; save(); return; }
    healthy=prefs.getBytesLength("guard")==sizeof(value) && prefs.getBytes("guard",&value,sizeof(value))==sizeof(value) &&
      value.version==1 && value.uncertainMask<4 && value.initialized<=1 &&
      value.periodDays[0]>=19 && value.periodDays[0]<=35 && value.periodDays[1]>=19 && value.periodDays[1]<=35 &&
      value.batchStatus[0]<=4 && value.batchStatus[1]<=4 &&
      (!value.lastRtc || HatchCalendar::validEpoch(value.lastRtc)) &&
      value.crc==HatchRecovery::crc32(&value,offsetof(Value,crc));
  }
  static_assert(sizeof(Value)==32,"Version the recovery guard before changing its schema");
  bool save() {
    if(!healthy) return false;
    value.crc=HatchRecovery::crc32(&value,offsetof(Value,crc)); Value check={};
    healthy=prefs.putBytes("guard",&value,sizeof(value))==sizeof(value) &&
      prefs.getBytes("guard",&check,sizeof(check))==sizeof(check) && memcmp(&check,&value,sizeof(value))==0;
    return healthy;
  }
private:
  Preferences prefs;
};
