#include "RtcValidation.h"
#include "BatchDisplay.h"
using namespace HatchRtc;
constexpr uint32_t base=HatchCalendar::epoch(2026,11,1,15,4,5);
constexpr uint8_t frame[]={0x05,0x04,0x15,1,0x01,0x11,0x26};
constexpr uint8_t twelve[]={0x05,0x04,0x63,1,0x01,0x11,0x26};
constexpr uint8_t corrupt[]={0x6a,0x04,0x15,1,0x01,0x11,0x26};
static_assert(decode(frame)==base && decode(twelve)==base,"12-hour PM and 24-hour frames decode identically");
static_assert(hour(0x52)==0 && hour(0x72)==12 && hour(0x41)==1 && hour(0x61)==13,"12-hour midnight/noon/AM/PM");
static_assert(hour(0x40)==-1 && hour(0x24)==-1 && hour(0x83)==-1 && !decode(corrupt),"Reject malformed hour and BCD frames");
constexpr bool transientRecovery() {
  Progress p;
  if(p.accept(0,base) || p.accept(1000,base+1) || !p.accept(2000,base+2)) return false;
  p.fail();p.fail();p.fail();
  if(!p.needsSync() || p.accept(6000,base+6) || p.accept(7000,base+7)) return false;
  if(!p.accept(8000,base+8) || p.needsSync()) return false;
  if(p.accept(9000,base+9999)) return false; // rejected frame cannot poison the trusted baseline
  return !p.accept(10000,base+10) && !p.accept(11000,base+11) && p.accept(12000,base+12) && !p.needsSync();
}
constexpr bool frozenAndBackward() {
  Progress p;
  p.accept(0,base);p.accept(1000,base+1);p.accept(2000,base+2);
  p.accept(3000,base+2);p.accept(4000,base+2);p.accept(5000,base+2);
  if(p.accept(6000,base+2) || !p.needsSync()) return false;
  if(p.accept(100000,base+3)) return false; // real stopped clock cannot be guessed forward
  p.reset();
  return !p.accept(0,base) && !p.accept(1000,base) && !p.accept(2000,base); // no advancing time
}
constexpr bool rollover() {
  Progress p; const uint32_t start=0xfffffc17UL;
  return !p.accept(start,base) && !p.accept(start+1000,base+1) && p.accept(start+2000,base+2);
}
static_assert(transientRecovery(),"Healthy clock requalifies without website; a bad frame does not latch it permanently OFF");
static_assert(frozenAndBackward(),"Frozen time remains untrusted until a real time source corrects it");
static_assert(rollover(),"RTC polling progress handles uptime rollover");
constexpr bool failedThenStuck() {
  Progress p; p.accept(0,base);p.accept(1000,base+1);p.accept(2000,base+2);p.fail();
  return !p.accept(2100,base+2) && !p.accept(2200,base+2) && !p.accept(2300,base+2);
}
static_assert(failedThenStuck(),"Requalification must observe fresh clock advancement");
static_assert(HatchDisplay::labelSource(true,true,8,true,9)==-2,"Live batch metadata wins");
static_assert(HatchDisplay::labelSource(false,true,8,true,9)==1,"Newest valid matching SD label is usable before RTC recovery");
static_assert(HatchDisplay::labelSource(false,true,10,true,9)==0,"Newest A label wins");
static_assert(HatchDisplay::labelSource(false,false,0,false,0)==-1,"No known label shows Loading, not an opaque numeric ID");
