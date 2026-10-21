#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "Calendar.h"
#include "Config.h"

// No Arduino types or pointers: copied through bounded FreeRTOS queues.
namespace HatchRecovery {
enum class Transaction : uint8_t { Idle, Pending, InProgress, Completed, Interrupted };
enum class BatchStatus : uint8_t { Empty, Active, Paused, Completed, Failed };
struct Motor {
  uint32_t cycle = 0, issued = 0, completed = 0, next = 0, lastSuccessfulCycle = 0;
  Transaction transaction = Transaction::Idle;
  bool positionHold = false;
};
struct Batch {
  char id[49] = {};
  char label[31] = {}, name[65] = {};
  uint16_t eggCount = 0;
  uint32_t start = 0, turningEnd = 0;
  uint16_t durationDays = HatchConfig::DefaultIncubationDays;
  BatchStatus status = BatchStatus::Empty;
};
struct State {
  uint32_t sequence = 0, rtc = 0, startup = 0, resetReason = 0, flags = 0;
  bool automatic = true, manualHeatRequested = false;
  int32_t temperatureMilli = 37500, humidityMilli = 55000, offsetMilli = 0;
  uint16_t interval[2] = {120,120}, duration[2] = {15,15};
  Batch batches[2];
  Motor motors[2];
  bool sensorValid = false, highAlarm = false, lowAlarm = false;
  bool heaterOn = false, lowerOn = false, upperOn = false;
  int32_t measuredTemperatureMilli = 0, measuredHumidityMilli = 0;
  uint32_t pidOutputMilli = 0;
};
// Sensor polling/freshness changed in the control recovery fix. These known
// prior timing values do not invalidate saved batch dates or motor intent.
constexpr bool sensorTimingCompatible(uint32_t interval,uint32_t stale) {
  return (interval==HatchConfig::SensorReadIntervalMs && stale==HatchConfig::SensorStaleAfterMs) ||
    (interval==2000 && stale==6500);
}
constexpr bool uncertain(Transaction t) { return t == Transaction::Pending || t == Transaction::InProgress; }
constexpr bool positionCheck(const Motor& m,uint32_t journalCycle,bool journalUncertain,bool bound) {
  return m.positionHold || uncertain(m.transaction) || journalUncertain || (bound && journalCycle>m.cycle);
}
constexpr bool journalAllows(uint8_t mask,uint8_t motor,bool preparing,bool running) {
  return !mask || (mask==(1<<motor) && (preparing || running));
}
constexpr uint32_t reconciledNext(uint32_t now,uint32_t savedNext) {
  return savedNext<=now ? now+HatchConfig::RecoveryResumeTurnDelaySeconds : savedNext;
}
constexpr int candidateSlot(bool a,uint32_t aSequence,uint32_t aRtc,bool b,uint32_t bSequence,uint32_t bRtc,uint32_t now,uint32_t floor) {
  return !HatchCalendar::validEpoch(now) || now<floor ? -1 :
    a && aRtc<=now ? b && bRtc<=now && bSequence>aSequence ? 1 : 0 : b && bRtc<=now ? 1 : -1;
}
constexpr bool complete(BatchStatus s) { return s == BatchStatus::Completed || s == BatchStatus::Failed; }
constexpr uint32_t end(const Batch& b) { return b.start + uint32_t(b.durationDays) * 86400UL; }
constexpr uint32_t lockdown(const Batch& b) { return b.turningEnd ? b.turningEnd : b.start + HatchConfig::LockdownAfterSeconds; }
constexpr bool timeMatches(const State& s, uint32_t now, uint32_t floor) {
  return HatchCalendar::validEpoch(now) && s.rtc <= now && now >= floor;
}
// 0 means unknown. Day 1 is the first 24 hours, independent of ESP32 uptime.
constexpr uint32_t day(const Batch& b, uint32_t now) {
  return !b.start || !HatchCalendar::validEpoch(now) || now < b.start ? 0 : (now-b.start)/86400UL+1;
}
inline bool valid(const State& s) {
  if (!s.sequence || !HatchCalendar::validEpoch(s.rtc) || !HatchCalendar::validEpoch(s.startup) ||
      s.startup > s.rtc || s.flags > 7 || s.temperatureMilli < 30000 || s.temperatureMilli > 37800 ||
      s.humidityMilli < 0 || s.humidityMilli > 100000 || s.offsetMilli < -2000 || s.offsetMilli > 2000 ||
      s.pidOutputMilli > 100000 || (s.lowerOn && s.upperOn)) return false;
  if(s.sensorValid && (s.measuredTemperatureMilli < -40000 || s.measuredTemperatureMilli > 80000 ||
      s.measuredHumidityMilli < 0 || s.measuredHumidityMilli > 100000)) return false;
  for (uint8_t i=0;i<2;++i) {
    const Batch& b=s.batches[i]; const Motor& m=s.motors[i];
    if (!memchr(b.id,0,sizeof(b.id)) || !memchr(b.label,0,sizeof(b.label)) || !memchr(b.name,0,sizeof(b.name)) ||
        b.eggCount>1000 || s.interval[i]<30 || s.interval[i]>360 || s.duration[i]<1 || s.duration[i]>600 ||
        b.durationDays<19 || b.durationDays>35 || uint8_t(b.status)>4 || uint8_t(m.transaction)>4) return false;
    if (!b.id[0]) {
      if (b.start || b.turningEnd || b.status!=BatchStatus::Empty || m.cycle || m.next || m.issued || m.completed) return false;
    } else {
      for(size_t p=0;b.id[p];++p) {
        const char c=b.id[p];
        if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='-'||c=='_'||c=='.'||c==':')) return false;
      }
      if (!HatchCalendar::validEpoch(b.start) || b.start>s.rtc || b.status==BatchStatus::Empty ||
          !HatchCalendar::validEpoch(end(b)) || !HatchCalendar::validEpoch(m.next) ||
          (b.turningEnd && (b.turningEnd<b.start || b.turningEnd>b.start+HatchConfig::LockdownAfterSeconds))) return false;
      if ((m.issued && (m.issued<b.start || m.issued>s.rtc)) ||
          (m.completed && (m.completed<b.start || m.completed>s.rtc)) || m.lastSuccessfulCycle>m.cycle ||
          (m.transaction!=Transaction::Idle && m.transaction!=Transaction::Interrupted && (!m.cycle || !m.issued)) ||
          (m.transaction==Transaction::Completed && (!m.completed || m.lastSuccessfulCycle!=m.cycle))) return false;
    }
  }
  const auto& a=s.batches[0]; const auto& b=s.batches[1];
  return !a.id[0] || strcmp(a.id,b.id)!=0 || (a.start==b.start && a.turningEnd==b.turningEnd &&
    a.durationDays==b.durationDays && a.status==b.status && a.eggCount==b.eggCount &&
    strcmp(a.label,b.label)==0 && strcmp(a.name,b.name)==0);
}
// Both files are parsed/CRC checked before selection. A future-dated newer copy
// cannot override an older copy whose timestamp is consistent with the RTC.
inline int select(const State* a, const State* b, uint32_t now, uint32_t floor) {
  const bool av=a && valid(*a) && timeMatches(*a,now,floor), bv=b && valid(*b) && timeMatches(*b,now,floor);
  if (!av) return bv ? 1 : -1;
  if (!bv) return 0;
  if (a->sequence==b->sequence && memcmp(a,b,sizeof(State))!=0) return -1;
  return candidateSlot(av,a->sequence,a->rtc,bv,b->sequence,b->rtc,now,floor);
}
#if __cplusplus >= 201402L
#define HATCH_REC_CONSTEXPR constexpr
#else
#define HATCH_REC_CONSTEXPR
#endif
inline HATCH_REC_CONSTEXPR uint32_t crcUpdate(uint32_t crc,uint8_t byte) {
  crc^=byte;
  for(uint8_t bit=0;bit<8;++bit) crc=(crc>>1)^(0xEDB88320UL & (0UL-(crc&1)));
  return crc;
}
inline HATCH_REC_CONSTEXPR uint32_t crcText(const char* bytes,size_t size) {
  uint32_t crc=0xFFFFFFFFUL;
  for(size_t i=0;i<size;++i) crc=crcUpdate(crc,uint8_t(bytes[i]));
  return ~crc;
}
inline uint32_t crc32(const void* data, size_t size) {
  uint32_t crc=0xFFFFFFFFUL; const uint8_t* bytes=static_cast<const uint8_t*>(data);
  for(size_t i=0;i<size;++i) {
    crc=crcUpdate(crc,bytes[i]);
  }
  return ~crc;
}
#undef HATCH_REC_CONSTEXPR
inline const char* transactionText(Transaction t) {
  const char* names[]={"IDLE","PENDING","IN_PROGRESS","COMPLETED","INTERRUPTED"};
  return uint8_t(t)<5 ? names[uint8_t(t)] : "INVALID";
}
inline const char* batchText(BatchStatus s) {
  const char* names[]={"Empty","Active","Paused","Completed","Failed"};
  return uint8_t(s)<5 ? names[uint8_t(s)] : "Invalid";
}
}
