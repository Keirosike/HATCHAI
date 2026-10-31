#include "RecoveryState.h"
#include "TurnSchedule.h"
using namespace HatchRecovery;
constexpr uint32_t boot=HatchCalendar::epoch(2026,10,21,12,0,0);
constexpr Batch batch() { Batch b{}; b.start=HatchCalendar::epoch(2026,10,10,14,30,0); return b; }
static_assert(day(batch(),boot)==11,"RTC elapsed day survives restart");
static_assert(day(batch(),HatchCalendar::epoch(2026,10,11,14,29,59))==1,"Day boundaries use exact start time");
static_assert(day(batch(),HatchCalendar::epoch(2026,10,11,14,30,0))==2,"Full elapsed 24 hours advances the day");
static_assert(day(batch(),0)==0,"Invalid RTC cannot invent Day 1");
static_assert(day(batch(),batch().start-1)==0,"Future batch starts are invalid");
static_assert(end(batch())==batch().start+21*86400UL,"Configured hatch period has an exact timestamp");
static_assert(lockdown(batch())==batch().start+17*86400UL,"Lockdown survives downtime");
static_assert(!HatchTurning::ageAllowed(lockdown(batch()),batch().start,batch().start),"No turn at lockdown boundary");
static_assert(candidateSlot(true,8,boot-100,true,9,boot-20,boot,0)==1,"Choose newest valid copy");
static_assert(candidateSlot(false,9,boot-20,true,8,boot-100,boot,0)==1,"CRC failure A uses B");
static_assert(candidateSlot(true,8,boot-100,false,9,boot-20,boot,0)==0,"CRC failure B uses A");
static_assert(candidateSlot(false,8,boot-100,false,9,boot-20,boot,0)==-1,"Two invalid copies produce a fault");
static_assert(candidateSlot(true,8,boot-100,true,9,boot+1,boot,0)==0,"Future newest copy cannot override valid fallback");
static_assert(candidateSlot(true,8,boot-100,true,9,boot-20,0,0)==-1,"No selection without RTC");
static_assert(candidateSlot(true,8,boot-100,true,9,boot-20,boot,boot+1)==-1,"Backwards RTC below durable journal floor faults");
constexpr Motor motor(Transaction t,uint32_t cycle=7,bool hold=false) { Motor m{}; m.transaction=t; m.cycle=cycle; m.positionHold=hold; return m; }
static_assert(positionCheck(motor(Transaction::Pending),7,false,true),"Power cut during PENDING needs position check");
static_assert(positionCheck(motor(Transaction::InProgress),7,false,true),"Power cut during movement never replays pulse");
static_assert(!positionCheck(motor(Transaction::Completed),7,false,true),"Verified timer completion does not require movement replay");
static_assert(positionCheck(motor(Transaction::Completed),7,true,true),"Uncleared NVS intent is conservative after completion write");
static_assert(positionCheck(motor(Transaction::Completed),8,false,true),"Older valid SD snapshot cannot erase a newer motor intent");
static_assert(positionCheck(motor(Transaction::Idle,0,true),0,false,false),"Unassigned interrupted roller retains its position hold");
static_assert(journalAllows(1,1,false,false),"A peer intent does not block an independent upper start");
static_assert(journalAllows(1,0,true,false),"Only the live prepared intent may proceed after verified checkpoints");
static_assert(journalAllows(3,0,true,false) && journalAllows(3,1,false,true),"Both prepared/running intents remain independently valid");
static_assert(!journalAllows(3,0,false,false) && !journalAllows(3,1,false,false),"Each unfinished own intent must still settle before restarting");
static_assert(journalAllows(2,0,false,false) && journalAllows(1,0,false,true),"Clearing/finishing one intent cannot invalidate its live peer");
static_assert(reconciledNext(boot,boot-7200)==boot+120,"Missed turns are skipped with a bounded resume delay");
static_assert(reconciledNext(boot,boot+600)==boot+600,"Future RTC schedule remains unchanged");
static_assert(crcText("123456789",9)==0xCBF43926UL,"Production CRC32 matches the standard test vector");
constexpr bool everyPowerCutStage() {
  for(unsigned cut=0;cut<100;++cut) {
    const Transaction stage=cut<20?Transaction::Idle:cut<40?Transaction::Pending:cut<80?Transaction::InProgress:Transaction::Completed;
    const bool notarySet=cut>=10 && cut<95;
    const bool hold=positionCheck(motor(stage),7,notarySet,true);
    if(cut>=10 && cut<95 && !hold) return false;
    if((stage==Transaction::Pending || stage==Transaction::InProgress) && !hold) return false;
    if(!hold && stage!=Transaction::Idle && stage!=Transaction::Completed) return false;
  }
  return true;
}
static_assert(everyPowerCutStage(),"Power cuts across intent/write/run/complete/clear ordering remain conservative");

static_assert(HatchRecovery::sensorTimingCompatible(2000,6500), "Known earlier sensor cadence remains recoverable");
static_assert(HatchRecovery::sensorTimingCompatible(HatchConfig::SensorReadIntervalMs,HatchConfig::SensorStaleAfterMs), "Current sensor timing is recoverable");
static_assert(!HatchRecovery::sensorTimingCompatible(100,6500), "Unrecognized sensor timing stays rejected");

constexpr bool chosenCutoff() {
  auto b=batch(); b.turningEnd=b.start+10*86400UL;
  return lockdown(b)==b.turningEnd && HatchTurning::ageAllowed(b.turningEnd-1,b.start,b.start,b.turningEnd) &&
    !HatchTurning::ageAllowed(b.turningEnd,b.start,b.start,b.turningEnd);
}
static_assert(chosenCutoff(), "Custom earlier cutoff and exact end boundary block motion");

static_assert(State().duration[0]==120 && State().duration[1]==120,"Fresh recovery state uses the 120-second default for both rollers");

static_assert(HatchRecovery::checkpointResult(0,0,0,99999)==HatchRecovery::CommitResult::Pending,"No queued request is never a commit");
static_assert(HatchRecovery::checkpointResult(8,7,6,10000)==HatchRecovery::CommitResult::Pending,"Old responses cannot complete a new request");
static_assert(HatchRecovery::checkpointResult(8,8,6,10001)==HatchRecovery::CommitResult::Verified,"Matching durable acknowledgment wins");
static_assert(HatchRecovery::checkpointResult(8,7,8,100)==HatchRecovery::CommitResult::Failed,"Matching write failure propagates immediately");
static_assert(HatchRecovery::checkpointResult(8,7,6,10001)==HatchRecovery::CommitResult::TimedOut,"Only an unanswered request times out");
static_assert(checkpointResult(8,7,6,uint32_t(3201)-uint32_t(3200))==CommitResult::Pending,"Next-update observation of a new startup request stays pending");
static_assert(checkpointResult(8,7,6,uint32_t(3)-uint32_t(0xfffffffeUL))==CommitResult::Pending,"Checkpoint waiting remains valid across millis rollover");

static_assert(HatchRecovery::dayFromStart(1792627200UL,1792627200UL)==1,"Start moment is Day 1 without any SD dependency");
static_assert(HatchRecovery::dayFromStart(1792627200UL,1792713599UL)==1,"First day lasts a full 24 hours");
static_assert(HatchRecovery::dayFromStart(1792627200UL,1792713600UL)==2,"Exact 24-hour boundary");
static_assert(HatchRecovery::dayFromStart(0,1792627200UL)==0 && HatchRecovery::dayFromStart(1792627200UL,1792627199UL)==0,"Missing/future start never invents a day");

constexpr bool interruptionSkipsInsteadOfReplaying() {
  HatchRecovery::Motor m;
  m.cycle=4; m.issued=1800000000; m.completed=1799990000;
  m.lastSuccessfulCycle=3; m.positionHold=true; m.transaction=HatchRecovery::Transaction::InProgress;
  HatchRecovery::skipInterrupted(m,5,1800000100,120,true);
  if(m.positionHold || m.transaction!=HatchRecovery::Transaction::Interrupted || m.cycle!=5 ||
      m.next!=1800007300 || m.completed!=1799990000 || m.lastSuccessfulCycle!=3) return false;
  m.next=1800010000;
  HatchRecovery::skipInterrupted(m,5,1800000100,120,true);
  if(m.next!=1800010000) return false;
  HatchRecovery::skipInterrupted(m,5,1800000100,120,false);
  return m.cycle==0 && m.next==0 && !m.positionHold && m.transaction==HatchRecovery::Transaction::Idle;
}
static_assert(interruptionSkipsInsteadOfReplaying(),"Interrupted runs skip a full interval, preserve history, and never replay or fabricate completion");
