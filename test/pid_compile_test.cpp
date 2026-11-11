#include "RelayPid.h"

constexpr void maintained(RelayPid& p,uint32_t start=0) {
  p.sample(start-40000,37.7f,true,37.7f);
  p.sample(start-35000,37.7f,true,37.7f);
  p.sample(start-30000,37.7f,true,37.7f);
  p.tick(start-30000,true,false,true,37.7f);
}


constexpr bool startupAndFailures() {
  RelayPid p; p.begin(0);
  if(p.tick(0,true,false,true,37.7f)) return false;
  p.sample(0,36.7f,true,37.7f);p.sample(5000,36.7f,true,37.7f);
  if(p.tick(5000,true,false,true,37.7f))return false;
  p.sample(10000,36.7f,true,37.7f);
  if(!p.tick(10000,true,false,true,37.7f))return false;
  p.sample(11000,0,false,37.7f);
  if(!p.tick(11000,true,false,true,37.7f))return false;
  p.sample(20000,0,false,37.7f); // Failed reads never extend the deadline.
  if(!p.tick(29999,true,false,true,37.7f))return false;
  if(p.tick(30000,true,false,true,37.7f))return false;
  p.sample(31000,36.7f,true,37.7f);p.sample(36000,36.7f,true,37.7f);
  if(p.tick(36000,true,false,true,37.7f))return false;
  p.sample(41000,36.7f,true,37.7f);
  if(!p.tick(41000,true,false,true,37.7f))return false;
  return !p.tick(61000,true,false,true,37.7f);
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
  RelayPid p; maintained(p); p.begin(0);
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
  RelayPid p; const uint32_t start=0xffffd8efUL; p.begin(start); maintained(p,start);
  p.sample(start,37,true,37.7f); p.sample(start+5000,37.2f,true,37.7f); p.sample(start+10000,37.4f,true,37.7f);
  p.sample(start+15000,37.6f,true,37.7f);
  return p.ready(start+15000) && p.output()==0 && !p.tick(start+15000,true,false,true,37.7f) &&
    !p.ready(start+35001);
}
static_assert(startupAndFailures(),"Qualified brief-fault hold, exact 20-second OFF, three-frame stale recovery");
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
  if(!p.tick(10002,false,true,true,37.7f)) return false;
  p.sample(15000,36,true,37.7f); p.sample(20000,36,true,37.7f);
  if(!p.tick(20001,false,true,true,37.7f)) return false;
  p.sample(30000,36,true,37.7f);p.sample(40000,36,true,37.7f);
  if(!p.tick(40001,false,true,true,37.7f))return false;
  p.reset(40002);
  return !p.relayOn() && !p.tick(40003,true,false,true,37.7f);
}
static_assert(manualAndReset(),"Immediate Manual ON/OFF and protected Automatic mode reset");
constexpr bool manualTargetProtection() {
  RelayPid p;const float target=37.5f,limit=target+0.2f;p.begin(0);
  p.sample(0,36,true,target);p.sample(5000,36,true,target);p.sample(10000,36,true,target);
  if(p.targetLimited(target)||!p.tick(10000,false,true,true,target))return false;
  p.sample(15000,limit,true,target);
  if(!p.targetLimited(target)||p.tick(15000,false,true,true,target)||p.relayOn())return false;
  p.sample(20000,36,true,target);p.sample(25000,36,true,target);
  if(!p.tick(25000,false,true,true,target))return false;
  p.sample(40000,36,true,target);
  if(!p.tick(40000,false,true,true,target))return false;
  return !p.tick(40001,false,false,true,target);
}
static_assert(manualTargetProtection(),"Manual ON/OFF remains independent of PID duty but retains exact target cutoff");
constexpr bool sustainedColdError() {
  RelayPid p; maintained(p); p.begin(0);
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
  RelayPid p; maintained(p); p.begin(0);
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

constexpr bool warmupThenPid() {
  RelayPid p;p.begin(0);
  for(uint32_t t=0;t<=60000;t+=1000) {
    if(t%5000==0)p.sample(t,37.6f,true,37.7f);
    const bool on=p.tick(t,true,false,true,37.7f);
    if(t>=10000 && (!on || p.output()!=100 || !p.warming()))return false;
  }
  p.sample(65000,37.7f,true,37.7f);
  if(p.warming() || p.tick(65000,true,false,true,37.7f))return false;
  p.sample(70000,37.6f,true,37.7f);
  p.tick(70000,true,false,true,37.7f);
  if(p.warming() || p.output()>=100)return false;
  p.reset(70001); // Fault/mode reset must not re-arm warm-up after target attainment.
  p.sample(75000,0,false,37.7f);
  if(p.tick(75000,true,false,true,37.7f))return false;
  p.sample(80000,37,true,37.7f);p.sample(85000,37,true,37.7f);p.sample(90000,37,true,37.7f);
  if(p.warming() || p.output()>=100)return false;
  p.retarget(90000,37.7f); // Existing mode-change path reuses retarget.
  if(p.warming() || p.output()>=100)return false;
  p.retarget(90001,37.8f);
  if(!p.warming() || p.output()!=100)return false;
  return !p.tick(90002,true,false,false,37.8f); // External safety always wins.
}
static_assert(warmupThenPid(),"Continuous qualified warm-up, target handoff, PID on dips, fault recovery and explicit higher target");

constexpr bool warmupRolloverAndManual() {
  RelayPid p; const uint32_t start=0xffffd8efUL;p.begin(start);
  p.sample(start,36,true,37.7f);p.sample(start+5000,36,true,37.7f);p.sample(start+10000,36,true,37.7f);
  if(!p.tick(start+10000,true,false,true,37.7f))return false;
  p.sample(start+15000,37.6f,true,37.7f);
  if(!p.tick(start+15000,true,false,true,37.7f))return false;
  p.sample(start+16000,37.7f,true,37.7f);
  if(p.tick(start+16000,true,false,true,37.7f))return false;
  RelayPid m;m.begin(0);
  m.sample(0,37.6f,true,37.7f);m.sample(5000,37.6f,true,37.7f);m.sample(10000,37.6f,true,37.7f);
  if(!m.tick(10000,false,true,true,37.7f))return false;
  m.sample(11000,37.7f,true,37.7f);
  if(!m.tick(11000,false,true,true,37.7f))return false;
  return !m.tick(11001,false,false,true,37.7f);
}
static_assert(warmupRolloverAndManual(),"Warm-up handles timer rollover without changing manual target/demand semantics");

constexpr bool relayCycleProtection() {
  RelayPid p;p.begin(0);
  p.sample(0,35,true,37.7f);p.sample(5000,35,true,37.7f);p.sample(10000,35,true,37.7f);
  if(!p.tick(10000,true,false,true,37.7f))return false;
  if(p.tick(10001,true,false,false,37.7f))return false;
  if(p.restartRemainingMs(20001)!=19999)return false;
  p.reset(20002); // Fault resets must not erase the relay wear-protection timer.
  p.sample(25000,35,true,37.7f);p.sample(30000,35,true,37.7f);
  if(p.tick(39999,true,false,true,37.7f))return false;
  p.sample(40000,35,true,37.7f);
  if(!p.tick(40000,true,false,true,37.7f))return false;
  return !p.tick(40001,true,false,false,37.7f);
}
static_assert(relayCycleProtection(),"30-second start spacing survives faults; safety OFF remains immediate");

constexpr bool immediateManualButtons() {
  RelayPid p;p.begin(0);
  p.sample(0,33.3f,true,37.7f);p.sample(1000,33.3f,true,37.7f);p.sample(2000,33.3f,true,37.7f);
  if(p.restartRemainingMs(2000,false)!=0 || !p.tick(2000,false,true,true,37.7f))return false;
  if(p.tick(2001,false,false,true,37.7f))return false;
  if(!p.tick(2002,false,true,true,37.7f))return false;
  if(p.tick(2003,false,true,false,37.7f))return false;
  p.sample(2004,0,false,37.7f);
  if(p.tick(2004,false,true,true,37.7f))return false;
  return !p.tick(2005,false,false,true,37.7f);
}
static_assert(immediateManualButtons(),"Manual buttons ignore PID intervals but never bypass sensor or external safety");

constexpr bool graceSafetyAndRollover() {
  const uint32_t start=0xffffd8efUL;
  RelayPid p;p.begin(start);
  p.sample(start,33.3f,true,37.7f);p.sample(start+5000,33.3f,true,37.7f);p.sample(start+10000,33.3f,true,37.7f);
  if(!p.tick(start+10000,false,true,true,37.7f))return false;
  p.sample(start+12000,0,false,37.7f);
  if(!p.tick(start+13000,false,true,true,37.7f))return false;
  if(p.tick(start+13001,false,false,true,37.7f))return false; // Manual OFF during grace.
  if(p.tick(start+13002,false,true,true,37.7f))return false; // No new ON from a failed sample.
  p.sample(start+14000,33.3f,true,37.7f);
  if(!p.tick(start+14000,false,true,true,37.7f))return false;
  p.sample(start+15000,39,false,37.7f); // A known hot value overrides grace even if RH fails.
  if(p.tick(start+15000,false,true,true,37.7f))return false;
  RelayPid q;q.begin(0);q.sample(0,33,true,37.7f);q.sample(5000,33,true,37.7f);
  q.sample(6000,0,false,37.7f);
  return !q.tick(6000,false,true,true,37.7f);
}
static_assert(graceSafetyAndRollover(),"Grace holds only existing heat, manual OFF/critical trip win, invalid startup cannot heat, timers roll over");

constexpr bool interruptedQualification() {
  RelayPid p;p.begin(0);
  p.sample(0,33.3f,true,37.2f);
  p.sample(5000,0,false,37.2f);
  if(p.tick(5000,false,true,true,37.2f))return false;
  p.sample(7100,33.3f,true,37.2f);
  p.sample(12100,0,false,37.2f);
  if(p.tick(12100,false,true,true,37.2f))return false;
  p.sample(14200,33.3f,true,37.2f);
  if(!p.tick(14200,false,true,true,37.2f))return false;
  if(p.tick(14201,false,false,true,37.2f))return false;
  p.sample(34200,0,false,37.2f);
  p.sample(36300,33.3f,true,37.2f);
  return !p.tick(36300,false,true,true,37.2f);
}
static_assert(interruptedQualification(),"Brief missed reads preserve qualification progress, never bypass three samples or stale cutoff");

constexpr bool automaticInterruptedWarmup() {
  RelayPid p;p.begin(0);
  p.sample(0,33.3f,true,37.2f);p.sample(5000,0,false,37.2f);
  if(p.tick(5000,true,false,true,37.2f))return false;
  p.sample(7100,33.3f,true,37.2f);p.sample(12100,0,false,37.2f);
  if(p.tick(12100,true,false,true,37.2f))return false;
  p.sample(14200,33.3f,true,37.2f);
  if(!p.tick(14200,true,false,true,37.2f) || p.output()!=100 || !p.warming())return false;
  p.sample(19200,0,false,37.2f);
  if(!p.tick(19200,true,false,true,37.2f))return false;
  p.sample(21300,37.2f,true,37.2f);
  if(p.tick(21300,true,false,true,37.2f) || p.warming())return false;
  p.sample(26300,37.1f,true,37.2f);
  return !p.warming() && p.output()<100;
}
static_assert(automaticInterruptedWarmup(),"Automatic qualifies across brief failures, warms fully, then maintains target with PID");
