#pragma once
#include <float.h>
#if __cplusplus >= 201402L
#define HATCH_PID_CX constexpr
#else
#define HATCH_PID_CX inline
#endif
#include "Config.h"

// Pure control logic: no GPIO, NVS, blocking waits, or PWM. Call sample only for
// actual sensor attempts; tick services the relay window on every loop.
class RelayPid {
public:
  HATCH_PID_CX bool update(uint32_t now,bool allowed,float measured,float target,bool automatic=true,bool manualOn=false) {
    if(!(measured>=-40 && measured<=80) || !(target>=30 && target<=37.8f)) allowed=false;
    return tick(now,automatic,manualOn,allowed,target);
  }
  HATCH_PID_CX uint32_t restartRemainingMs(uint32_t now,bool automatic=true) const {
    if(_on || !automatic) return 0;
    const uint32_t offWait=uint32_t(now-_lastChange)>=HatchConfig::HeaterMinimumOffMs ? 0 :
      HatchConfig::HeaterMinimumOffMs-uint32_t(now-_lastChange);
    const uint32_t cycleWait=_everOn && uint32_t(now-_lastOn)<HatchConfig::HeaterMinimumCycleMs ?
      HatchConfig::HeaterMinimumCycleMs-uint32_t(now-_lastOn) : 0;
    return offWait>cycleWait ? offWait : cycleWait;
  }
  HATCH_PID_CX void begin(uint32_t now) { _lastChange=now; }
  HATCH_PID_CX void reset(uint32_t now) {
    off(now); _integral=0; _output=0; _credit=0; _window=false; _derivative=0;
  }
  HATCH_PID_CX void retarget(uint32_t now,float target) {
    const float rate=_derivative;
    reset(now); _derivative=rate;
    if(target!=_target) _warming=!_haveSample || _temperature<target;
    _target=target; _warmupEnd=false;
    // Recompute immediately without pretending the retained sample is new.
    if(ready(now) && !_tripped && _temperature<target &&
        !(_derivative>0 && _temperature+_derivative*HatchConfig::HeaterCoastSeconds>=target))
      _output=clamp(HatchConfig::HeaterKp*(target-_temperature)-HatchConfig::HeaterKd*_derivative,0,100);
    if(_warming && ready(now) && !_tripped) _output=100;
  }
  HATCH_PID_CX void sample(uint32_t now,float temperature,bool valid,float target) {
    _target=target;
    if(finite(temperature) && temperature<=80 && temperature>=HatchConfig::HeaterTripC) _tripped=true;
    if(!valid || !finite(temperature) || temperature < -40 || temperature > 80) {
      _sampleFault=true;
      // A failed attempt never renews the last valid sample's age. Preserve
      // valid qualification history inside the bounded grace period.
      // ready() still requires three stable samples before any heating.
      if(!_haveSample || uint32_t(now-_lastSample)>=HatchConfig::SensorStaleAfterMs) {
        _good=0; _output=0; _integral=0; _haveSample=false;
      }
      return;
    }
    _sampleFault=false;
    const uint32_t elapsed=now-_lastSample;
    const bool continuous=_haveSample && elapsed<HatchConfig::SensorStaleAfterMs;
    _good=continuous && (_good>=3 || absolute(temperature-_temperature)<=0.5f) ? (_good<3 ? _good+1 : 3) : 1;
    const float dt=continuous && elapsed ? elapsed/1000.0f : 0;
    const float slope=dt ? (temperature-_temperature)/dt : 0;
    _derivative=continuous ? _derivative+0.25f*(slope-_derivative) : 0;
    _temperature=temperature; _lastSample=now; _haveSample=true;
    if(_good<3 || _tripped) { _output=0; return; }
    // Warm up once per boot/target edit. Fault resets preserve this latch so
    // normal dips and sensor recovery cannot silently re-enable full heating.
    if(_warming && temperature>=target) {
      _warming=false; _warmupEnd=true; _window=false; _credit=0; _integral=0;
    }
    if(_warming) { _output=100; _integral=0; return; }
    const float error=target-temperature;
    // Conditional integration below prevents saturation windup. Keep integral
    // action for sustained cold error: clearing it outside a 2 C band traps a
    // heat-loss equilibrium below target at only proportional power. Derivative
    // acts on measurement, not setpoint, so a target edit cannot kick the output.
    const float p=HatchConfig::HeaterKp*error;
    const float d=HatchConfig::HeaterKd*_derivative;
    const float candidate=clamp(_integral+HatchConfig::HeaterKi*error*dt,0,100);
    const float proposed=p+candidate-d;
    if((proposed>=0 && proposed<=100) || (proposed>100 && error<0) || (proposed<0 && error>0)) _integral=candidate;
    _output=clamp(p+_integral-d,0,100);
    // Anticipate residual PTC/chamber heat on a measured rising trajectory.
    if(temperature>=target || (slope>0 && temperature+_derivative*HatchConfig::HeaterCoastSeconds>=target)) {
      _output=0; _credit=0; if(error<=0) _integral*=0.9f;
    }
  }
  HATCH_PID_CX bool ready(uint32_t now) const {
    return _haveSample && _good>=3 && uint32_t(now-_lastSample)<HatchConfig::SensorStaleAfterMs;
  }
  HATCH_PID_CX bool temporarySensorFault() const { return _sampleFault; }
  HATCH_PID_CX bool targetLimited(float target) const { return _temperature>=target+0.2f; }
  HATCH_PID_CX bool tick(uint32_t now,bool automatic,bool manualDemand,bool storageReady,float target) {
    if(!storageReady || !ready(now) || _tripped || targetLimited(target)) {
      reset(now); return false; // safety OFF overrides all relay dwell limits
    }
    if(_sampleFault) {
      // Hold the previous ON state only; a failed read cannot authorize a new
      // ON transition. Manual OFF and all gates above remain immediate.
      if(!automatic && !manualDemand) off(now);
      return _on;
    }
    if(!automatic) {
      _window=false; _credit=0; _integral=0; _output=0;
      if(!manualDemand) off(now); // explicit user OFF is immediate
      else if(!_on) on(now); // Manual button is direct demand, not a PID pulse.
      return _on;
    }
    if(_warmupEnd) { off(now); _warmupEnd=false; }
    if(_warming) {
      _output=100; _window=false; _credit=0; _integral=0;
      if(!_on && !restartRemainingMs(now)) on(now);
      return _on;
    }
    if(!_window || uint32_t(now-_windowStart)>=HatchConfig::HeaterWindowMs) {
      if(_window && uint32_t(now-_windowStart)>=2*HatchConfig::HeaterWindowMs) _credit=0;
      _windowStart=now; _window=true; _fired=_on;
      _credit=clamp(_credit+_output*HatchConfig::HeaterWindowMs/100,0,2.0f*HatchConfig::HeaterWindowMs);
      // Accumulate sub-minimum demand across windows rather than chatter or
      // discard low duty cycles. Intermediate pulses leave >=10 s OFF.
      const uint32_t maxPulse=HatchConfig::HeaterWindowMs-HatchConfig::HeaterMinimumOffMs;
      _budget=_credit>=HatchConfig::HeaterWindowMs ? HatchConfig::HeaterWindowMs :
        _credit>=HatchConfig::HeaterMinimumOnMs ? uint32_t(_credit>maxPulse ? maxPulse : _credit) : 0;
      _credit-=_budget;
    }
    const uint32_t phase=now-_windowStart;
    if(_on && (phase>=_budget || _output<=0) && uint32_t(now-_lastChange)>=HatchConfig::HeaterMinimumOnMs) off(now);
    if(!_on && !_fired && _output>0 && phase<_budget && _budget-phase>=HatchConfig::HeaterMinimumOnMs &&
        !restartRemainingMs(now)) { on(now); _fired=true; }
    return _on;
  }
  HATCH_PID_CX bool tripped() const { return _tripped; }
  HATCH_PID_CX bool warming() const { return _warming; }
  HATCH_PID_CX void latch() { _tripped=true; }
  HATCH_PID_CX void clearTrip() { _tripped=false; _good=0; _haveSample=false; }
  HATCH_PID_CX float output() const { return _output; }
  HATCH_PID_CX float integral() const { return _integral; }
  HATCH_PID_CX bool relayOn() const { return _on; }
private:
  static constexpr bool finite(float x) { return x==x && x<=FLT_MAX && x>=-FLT_MAX; }
  static constexpr float absolute(float x) { return x<0 ? -x : x; }
  static constexpr float clamp(float x,float low,float high) { return x<low ? low : x>high ? high : x; }
  HATCH_PID_CX void off(uint32_t now) { if(_on) { _on=false; _lastChange=now; } }
  HATCH_PID_CX void on(uint32_t now) { _on=true; _lastChange=now; _lastOn=now; _everOn=true; }
  bool _everOn=false;
  uint32_t _lastOn=0;
  bool _on=false,_window=false,_fired=false,_haveSample=false,_tripped=false;
  bool _warming=true,_warmupEnd=false;
  bool _sampleFault=false;
  uint8_t _good=0;
  uint32_t _lastChange=0,_lastSample=0,_windowStart=0,_budget=0;
  float _temperature=0,_integral=0,_derivative=0,_output=0,_credit=0,_target=0;
};

#undef HATCH_PID_CX
