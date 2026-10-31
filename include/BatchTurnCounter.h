#pragma once
#include "RecoveryState.h"

namespace HatchBatchTurns {
struct Record {
  char id[49] = {};
  uint8_t padding[3] = {};
  uint32_t start=0, count[2]={0,0}, serial[2]={0,0}, crc=0;
};
// Serial IDs are durable before relay ON. A duplicate completion cannot count twice.
#if __cplusplus >= 201402L
constexpr
#else
inline
#endif
bool complete(Record& r,uint8_t motor,uint32_t serial) {
  if(motor>1 || !serial || serial<=r.serial[motor] || r.count[motor]==UINT32_MAX) return false;
  ++r.count[motor]; r.serial[motor]=serial; return true;
}
}

#ifdef ARDUINO
#include <Preferences.h>
class BatchTurnCounter {
public:
  void begin() { _healthy=_prefs.begin("hatchai-count",false); }
  bool read(const char* id,uint32_t start,HatchBatchTurns::Record& r) const {
    if(!_healthy || !id[0] || !start) return false;
    r={}; snprintf(r.id,sizeof(r.id),"%s",id); r.start=start;
    char key[15]; makeKey(r,key);
    if(!_prefs.isKey(key)) return true; // No historical completions are invented.
    HatchBatchTurns::Record saved={};
    if(_prefs.getBytesLength(key)!=sizeof(saved) || _prefs.getBytes(key,&saved,sizeof(saved))!=sizeof(saved) ||
        memcmp(saved.id,r.id,sizeof(r.id)) || saved.start!=start ||
        saved.crc!=HatchRecovery::crc32(&saved,offsetof(HatchBatchTurns::Record,crc))) return false;
    r=saved; return true;
  }
  bool completed(const char* id,uint32_t start,uint8_t motor,uint32_t serial) {
    HatchBatchTurns::Record r;
    if(!read(id,start,r)) return false;
    if(!HatchBatchTurns::complete(r,motor,serial)) return serial && motor<2 && serial==r.serial[motor];
    char key[15]; makeKey(r,key);
    r.crc=HatchRecovery::crc32(&r,offsetof(HatchBatchTurns::Record,crc));
    HatchBatchTurns::Record check={};
    _healthy=_prefs.putBytes(key,&r,sizeof(r))==sizeof(r) &&
      _prefs.getBytes(key,&check,sizeof(check))==sizeof(check) && !memcmp(&r,&check,sizeof(r));
    return _healthy;
  }
private:
  static void makeKey(const HatchBatchTurns::Record& r,char* key) {
    snprintf(key,15,"b%08lx",static_cast<unsigned long>(HatchRecovery::crc32(&r,offsetof(HatchBatchTurns::Record,count))));
  }
  mutable Preferences _prefs;
  bool _healthy=false;
};
#endif
