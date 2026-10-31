#include "TurnSchedule.h"
#include "TurnCycle.h"
#include "BatchTurnCounter.h"

constexpr bool simultaneousCompletions() {
  HatchBatchTurns::Record counts={};
  counts.count[0]=31; counts.count[1]=17;
  TurnCycle lower(true,true,1000,1000,60000), upper(true,true,1000,1000,60000);
  const uint32_t loopTime=61000;
  if(!lower.pulseExpired(loopTime,60000) || !HatchBatchTurns::complete(counts,0,31)) return false;
  lower.active=false;
  const uint32_t heartbeatAfterLowerSave=61040, observedAfterCopy=61041;
  // The old loop timestamp would falsely report a stalled worker here.
  if(HatchTurning::workerResponsive(loopTime,heartbeatAfterLowerSave)) return false;
  if(!HatchTurning::workerResponsive(observedAfterCopy,heartbeatAfterLowerSave)) return false;
  if(!upper.pulseExpired(observedAfterCopy,60000) || !HatchBatchTurns::complete(counts,1,17)) return false;
  upper.active=false;
  return counts.count[0]==32 && counts.count[1]==18 && !lower.active && !upper.active;
}
static_assert(simultaneousCompletions(),"Peer save latency must not cancel Upper's full run");
static_assert(HatchTurning::workerResponsive(3,0xfffffffeUL),"Heartbeat rollover remains valid");
static_assert(!HatchTurning::workerResponsive(20001,10000),"Actual SD stalls still block motion");
static_assert(HatchTurning::workerResponsive(20000,10000),"Timeout boundary remains unchanged");
constexpr TurnCycle stopped(true,false,1000,1000,60000);
static_assert(!stopped.pulseExpired(61041,60000),"Interrupted runs do not count later");
