#include "RelayPid.h"
#include "ThermalSafety.h"

constexpr bool combinedSensorGrace() {
  ThermalSafety safety;RelayPid relay;relay.begin(0);
  for(uint32_t t=0;t<=10000;t+=5000) {
    safety.sample(t,true,33.3f);relay.sample(t,33.3f,true,37.7f);
    relay.update(t,safety.heatAllowed(t),safety.controlTemperature(),37.7f);
  }
  if(!relay.relayOn())return false;
  for(uint32_t t=12000;t<30000;t+=2000) {
    safety.sample(t,false,0);relay.sample(t,0,false,37.7f);
    if(!relay.update(t,safety.heatAllowed(t),safety.controlTemperature(),37.7f))return false;
  }
  if(relay.update(30000,safety.heatAllowed(30000),safety.controlTemperature(),37.7f))return false;
  for(uint32_t t=31000;t<=41000;t+=5000) {
    safety.sample(t,true,33.3f);relay.sample(t,33.3f,true,37.7f);
    const bool on=relay.update(t,safety.heatAllowed(t),safety.controlTemperature(),37.7f);
    if(t<41000 && on)return false;
  }
  if(!relay.relayOn())return false;
  safety.sample(42000,false,38.2f);relay.sample(42000,38.2f,false,37.7f);
  return !relay.update(42000,safety.heatAllowed(42000),safety.controlTemperature(),37.7f);
}
static_assert(combinedSensorGrace(),"Actual thermal and relay gates retain bounded grace, requalify stale sensor and immediately inhibit known heat");
