#pragma once
#include <stdint.h>
#include <string.h>

namespace HatchDisplay {
// Metadata may arrive after the durable assignment but before SD restoration.
// Copy only display fields and identity, never motor state or schedules.
template<class Batch>
bool applyMetadata(Batch& batch,const char* assignedId,uint32_t start,
    const char* requestedId,const char* label,const char* name,uint16_t eggs) {
  if(!assignedId[0] || strcmp(assignedId,requestedId)!=0 ||
      strlen(requestedId)>=sizeof(batch.id) || strlen(label)>=sizeof(batch.label) ||
      strlen(name)>=sizeof(batch.name) || eggs>1000) return false;
  strcpy(batch.id,requestedId);batch.start=start;
  strcpy(batch.label,label);strcpy(batch.name,name);batch.eggCount=eggs;
  return true;
}
// Loading is transient, never a permanent substitute for absent metadata.
constexpr const char* missingLabel(bool loaded,uint32_t elapsed,uint32_t timeout) {
  return !loaded && elapsed<timeout ? "Loading" : "No label";
}
// Live metadata wins; otherwise use the newest CRC-valid matching SD label even
// before RTC-based recovery can run. Never substitute an opaque internal ID.
constexpr int labelSource(bool live,bool a,uint32_t sequenceA,bool b,uint32_t sequenceB) {
  return live ? -2 : b && (!a || sequenceB>sequenceA) ? 1 : a ? 0 : -1;
}
// Motor 1 is lower (index 0); motor 2 is upper (index 1).
constexpr int predictionMotor(bool lower,bool upper,bool shared,uint32_t page) {
  return upper ? lower && !shared && (page&1) ? 0 : 1 : lower ? 0 : -1;
}
}
