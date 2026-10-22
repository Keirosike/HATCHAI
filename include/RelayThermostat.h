#pragma once
#include "Config.h"
#if __cplusplus >= 201402L
#define HATCH_THERMOSTAT_CONSTEXPR constexpr
#else
#define HATCH_THERMOSTAT_CONSTEXPR
#endif

// Ordinary relay thermostat. No duty windows or periodic heat pulses.
class RelayThermostat {
public:
  HATCH_THERMOSTAT_CONSTEXPR void reset(uint32_t now) {
    if (_on) _hasSwitchedOff=true;
    _on=false; _offSince=now;
  }
  HATCH_THERMOSTAT_CONSTEXPR bool update(uint32_t now,bool allowed,float measured,
      float target,bool automatic=true,bool manualOn=false) {
    if (!allowed || !(measured>=-40 && measured<=80) || !(target>=30 && target<=37.8f))
      return turnOff(now);
    bool requested=_on;
    if (!automatic) requested=manualOn;
    else if (measured<target-HatchConfig::HeaterHysteresisC) requested=true;
    else if (measured>target+HatchConfig::HeaterHysteresisC) requested=false;
    // At either boundary and inside the band, retain the actual relay state.
    if (!requested) return turnOff(now);
    const uint32_t restartMs = automatic && _hasSwitchedOff ?
      HatchConfig::HeaterAutomaticRestartMs : HatchConfig::HeaterRelayMinimumOffMs;
    if (!_on && uint32_t(now-_offSince)>=restartMs) _on=true;
    return _on;
  }
  constexpr bool isOn() const { return _on; }
  constexpr uint32_t restartRemainingMs(uint32_t now,bool automatic=true) const {
    return _on ? 0 : uint32_t(now-_offSince) >=
      (automatic && _hasSwitchedOff ? HatchConfig::HeaterAutomaticRestartMs : HatchConfig::HeaterRelayMinimumOffMs) ? 0 :
      (automatic && _hasSwitchedOff ? HatchConfig::HeaterAutomaticRestartMs : HatchConfig::HeaterRelayMinimumOffMs)-uint32_t(now-_offSince);
  }
private:
  HATCH_THERMOSTAT_CONSTEXPR bool turnOff(uint32_t now) {
    if (_on) { _on=false; _offSince=now; _hasSwitchedOff=true; }
    return false;
  }
  bool _on=false, _hasSwitchedOff=false;
  uint32_t _offSince=0;
};
#undef HATCH_THERMOSTAT_CONSTEXPR
