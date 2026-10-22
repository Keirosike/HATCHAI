#include "BatchTurnCounter.h"
#include "TurnCycle.h"
using namespace HatchBatchTurns;
constexpr bool counts() {
  Record r={};
  if(!complete(r,0,7) || r.count[0]!=1 || r.count[1]) return false;
  if(complete(r,0,7) || complete(r,0,6) || r.count[0]!=1) return false;
  if(!complete(r,1,9) || r.count[1]!=1 || r.count[0]!=1) return false;
  // Interrupted serial 8 was never passed to completion; a later full run is 9.
  if(!complete(r,0,9) || r.count[0]!=2) return false;
  if(complete(r,2,1) || complete(r,0,0)) return false;
  r.count[0]=UINT32_MAX;
  return !complete(r,0,10) && r.count[0]==UINT32_MAX;
}
static_assert(counts(),"Count only distinct completed cycles, independently per roller");
constexpr TurnCycle running(true,true,1000,1000,60000);
constexpr TurnCycle stopped(true,false,1000,1000,60000);
static_assert(!running.pulseExpired(60999,60000),"Partial run is not complete");
static_assert(running.pulseExpired(61000,60000),"Full 60-second run is complete");
static_assert(!stopped.pulseExpired(99999,60000),"Stopped run never completes later");
