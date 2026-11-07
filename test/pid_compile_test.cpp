#include "RelayPid.h"

constexpr bool startupAndFailures() {
  RelayPid p; p.begin(0);
  if(p.tick(0,true,false,true,37.7f)) return false;
  p.sample(0,36.7f,true,37.7f); p.sample(5000,36.7f,true,37.7f);
  if(p.tick(5000,true,false,true,37.7f)) return false;
  p.sample(10000,36.7f,true,37.7f);
  if(!p.tick(10000,true,false,true,37.7f)) return false;
  p.sample(11000,0,false,37.7f);
  if(p.tick(11000,true,false,true,37.7f)) return false; // safety overrides minimum ON
  p.sample(15000,36.7f,true,37.7f); p.sample(20000,36.7f,true,37.7f);
  if(p.tick(20000,true,false,true,37.7f)) return false;
  p.sample(25000,36.7f,true,37.7f);
  if(!p.tick(25000,true,false,true,37.7f)) return false;
  return !p.tick(45001,true,false,true,37.7f); // stale with no new attempts
}
constexpr bool temperatureTrip() {
  RelayPid p; p.begin(0);
  p.sample(0,36,true,37.7f); p.sample(5000,36,true,37.7f); p.sample(10000,36,true,37.7f);
  if(!p.tick(10000,true,false,true,37.7f)) return false;
  p.sample(11000,39,true,37.7f);
  if(!p.tripped() || p.tick(11000,false,true,true,37.7f)) return false;
  p.sample(15000,37,true,37.7f); p.sample(20000,37,true,37.7f); p.sample(25000,37,true,37.7f);
  return !p.tick(25000,true,false,true,37.7f) && p.tripped();
}
constexpr bool dwellAndLowDuty() {
  RelayPid p; p.begin(0);
  bool previous=false; uint32_t change=0; unsigned cycles=0;
  for(uint32_t now=0;now<=600000;now+=1000) {
    if(now%5000==0) p.sample(now,37.6f,true,37.7f);
    const bool on=p.tick(now,true,false,true,37.7f);
    if(on!=previous) {
      if(now-change<(previous ? HatchConfig::HeaterMinimumOnMs : HatchConfig::HeaterMinimumOffMs)) return false;
      if(on) ++cycles;
      change=now; previous=on;
    }
    if(p.output()<0 || p.output()>100 || p.integral()<0 || p.integral()>100) return false;
  }
  return cycles>0 && cycles<=30; // small demand is accumulated, no fast PWM
}
constexpr bool saturationAndSetpoint() {
  RelayPid p; p.begin(0);
  for(uint32_t n=0;n<=600000;n+=5000) { p.sample(n,25,true,37.7f); p.tick(n,true,false,true,37.7f); }
  if(p.integral()!=0 || p.output()!=100) return false;
  p.reset(600001); // controller immediately resets demand on a validated target edit
  p.sample(605000,37.9f,true,37.7f);
  if(p.tick(605000,true,false,true,37.7f) || p.output()!=0) return false;
  return !p.tick(610000,false,true,false,37.7f); // storage protection also in Manual
}
constexpr bool coastAndRollover() {
  RelayPid p; const uint32_t start=0xffffd8efUL; p.begin(start);
  p.sample(start,37,true,37.7f); p.sample(start+5000,37.2f,true,37.7f); p.sample(start+10000,37.4f,true,37.7f);
  p.sample(start+15000,37.6f,true,37.7f);
  return p.ready(start+15000) && p.output()==0 && !p.tick(start+15000,true,false,true,37.7f) &&
    !p.ready(start+35001);
}
static_assert(startupAndFailures(),"Safe startup, immediate failed-read OFF, three-frame recovery, stale OFF");
static_assert(temperatureTrip(),"Independent high-temperature latch blocks Auto and Manual after cooling");
static_assert(dwellAndLowDuty(),"Real PID/TPO protects minimum ON/OFF time and accumulates small demand");
static_assert(saturationAndSetpoint(),"Anti-windup, hot setpoint change and storage failure protection");
static_assert(coastAndRollover(),"Residual heat coasting and timer rollover");
constexpr bool immediateTarget() {
  RelayPid p; p.begin(0);
  p.sample(0,36.7f,true,36.7f); p.sample(5000,36.7f,true,36.7f); p.sample(10000,36.7f,true,36.7f);
  p.retarget(10001,37.7f);
  if(p.output()<24 || !p.ready(10001)) return false;
  p.retarget(10002,36);
  if(p.output()!=0 || p.relayOn()) return false;
  p.retarget(30001,37.7f);
  return !p.ready(30001) && p.output()==0; // target edits never refresh sensor age
}
static_assert(immediateTarget(),"Targets recalculate now without refreshing or inventing a sensor sample");
constexpr bool manualAndReset() {
  RelayPid p; p.begin(0);
  p.sample(0,36,true,37.7f); p.sample(5000,36,true,37.7f); p.sample(10000,36,true,37.7f);
  if(!p.tick(10000,false,true,true,37.7f)) return false;
  if(p.tick(10001,false,false,true,37.7f)) return false;
  if(p.tick(10002,false,true,true,37.7f)) return false;
  p.sample(15000,36,true,37.7f); p.sample(20000,36,true,37.7f);
  if(!p.tick(20001,false,true,true,37.7f)) return false;
  p.reset(20002);
  return !p.relayOn() && !p.tick(20003,true,false,true,37.7f);
}
static_assert(manualAndReset(),"Manual dwell, immediate user OFF and mode-reset behavior");
constexpr bool sustainedColdError() {
  RelayPid p; p.begin(0);
  bool previous=false; uint32_t change=0;
  for(uint32_t now=0;now<=900000;now+=1000) {
    if(now%5000==0) p.sample(now,35.5f,true,37.7f);
    const bool on=p.tick(now,true,false,true,37.7f);
    if(on!=previous) {
      if(now-change<(previous ? HatchConfig::HeaterMinimumOnMs : HatchConfig::HeaterMinimumOffMs)) return false;
      change=now; previous=on;
    }
  }
  // Persistent heat loss must build demand beyond the ~55% proportional term,
  // even when the chamber remains more than 2 C below the selected target.
  if(p.integral()<40 || p.output()<99 || p.output()>100) return false;
  p.sample(905000,37.7f,true,37.7f);
  return p.output()==0 && !p.tick(905000,true,false,true,37.7f);
}
static_assert(sustainedColdError(),"A 35.5 C plateau increases heat demand without breaking dwell or target shutoff");
constexpr bool nearTargetPlateau() {
  RelayPid p; p.begin(0);
  p.sample(0,36.8f,true,37.7f); p.sample(5000,36.8f,true,37.7f);
  p.sample(10000,36.8f,true,37.7f);
  const float initial=p.output();
  bool previous=false; uint32_t change=0;
  for(uint32_t now=10000;now<=370000;now+=1000) {
    if(now>10000 && now%5000==0) p.sample(now,36.8f,true,37.7f);
    const bool on=p.tick(now,true,false,true,37.7f);
    if(on!=previous) {
      if(now-change<(previous ? HatchConfig::HeaterMinimumOnMs : HatchConfig::HeaterMinimumOffMs)) return false;
      change=now; previous=on;
    }
  }
  // Six minutes of persistent 0.9 C error should add ~32.4 points of demand.
  if(p.output()-initial<32 || p.output()-initial>33) return false;
  p.retarget(370001,36.5f);
  return p.output()==0 && !p.relayOn();
}
static_assert(nearTargetPlateau(),"Near-target heat loss builds demand faster with relay dwell and lower-target OFF");
