// Compile-time execution of the production thermostat; no GPIO is involved.
#include "RelayThermostat.h"
#include "ThermalSafety.h"

constexpr bool boundaries() {
  RelayThermostat h; h.reset(0);
  const float low=37.5f-HatchConfig::HeaterHysteresisC;
  const float high=37.5f+HatchConfig::HeaterHysteresisC;
  if (h.update(4999,true,low-0.1f,37.5f)) return false;
  if (h.update(5000,true,low,37.5f)) return false; // OFF retained at boundary
  if (!h.update(5001,true,low-0.1f,37.5f)) return false;
  if (!h.update(6000,true,low,37.5f) || !h.update(7000,true,37.5f,37.5f) ||
      !h.update(8000,true,high,37.5f)) return false;
  if (h.update(8001,true,high+0.1f,37.5f)) return false; // OFF immediately
  if (h.update(13001,true,high,37.5f) || h.update(13002,true,low,37.5f)) return false;
  if (h.update(38000,true,low-0.1f,37.5f)) return false;
  return h.update(38001,true,low-0.1f,37.5f);
}
static_assert(boundaries(), "Strict thresholds, equality/inside-band retention, minimum OFF guard");

constexpr bool noPeriodicPulses() {
  RelayThermostat h; h.reset(0);
  for (uint32_t now=5000;now<=3600000;now+=1000)
    if (!h.update(now,true,37.0f,37.5f)) return false;
  return h.update(3600001,true,37.5f,37.5f); // holds ON, no window resets
}
static_assert(noPeriodicPulses(), "One hour of constant heat need never schedules an OFF pulse");

constexpr bool manualAndSafety() {
  RelayThermostat h; h.reset(0);
  if (!h.update(5000,true,37,37.5f,false,true)) return false;
  if (h.update(5001,true,37,37.5f,false,false)) return false;
  if (h.update(10000,true,37,37.5f,false,true)) return false;
  if (!h.update(10001,true,37,37.5f,false,true)) return false;
  if (h.update(10002,false,37,37.5f,false,true)) return false;
  if (h.update(15002,true,-41.0f,37.5f)) return false;
  if (h.update(15003,true,37,0.0f)) return false;
  if (h.update(15004,true,37,38)) return false;
  h.reset(20000); // mode/target changes and recovery start from OFF
  return !h.update(25000,true,37.5f,37.5f);
}
static_assert(manualAndSafety(), "Manual ON/OFF, safety override, invalid input, safe reset");

constexpr bool rollover() {
  RelayThermostat h; h.reset(0xfffffff0UL);
  if (h.update(uint32_t(0xfffffff0UL+4999UL),true,37,37.5f)) return false;
  return h.update(uint32_t(0xfffffff0UL+5000UL),true,37,37.5f);
}
static_assert(rollover(), "OFF timing is safe across millis rollover");

constexpr bool sensorRecovery() {
  ThermalSafety s; RelayThermostat h; h.reset(0);
  s.sample(0,true,37); s.sample(5000,true,37);
  if (h.update(5000,s.heatAllowed(5000),s.lastTemperature,37.5f)) return false;
  s.sample(10000,true,37);
  if (!h.update(10000,s.heatAllowed(10000),s.lastTemperature,37.5f)) return false;
  s.sample(15000,false,0);
  if (!h.update(15000,s.heatAllowed(15000),s.lastTemperature,37.5f)) return false;
  s.update(30001,0);
  if (h.update(30001,s.heatAllowed(30001),s.lastTemperature,37.5f)) return false;
  s.sample(35000,true,37); s.sample(40000,true,37); s.sample(45000,true,37);
  if (h.update(45000,s.heatAllowed(45000),s.lastTemperature,37.5f)) return false;
  s.sample(60001,true,37);
  if (!h.update(60001,s.heatAllowed(60001),s.lastTemperature,37.5f)) return false;
  s.sample(65000,true,39);
  return !h.update(65000,s.heatAllowed(65000),s.lastTemperature,37.5f) && s.critical;
}
static_assert(sensorRecovery(), "Transient tolerance, stale OFF, stable automatic recovery, raw overheat OFF");

constexpr bool rapidCyclingAndReset() {
  RelayThermostat h; h.reset(0);
  if (!h.update(5000,true,37,37.5f)) return false;
  if (h.update(10000,true,37.9f,37.5f)) return false;
  for (uint32_t t=15000;t<40000;t+=5000)
    if (h.update(t,true,37,37.5f)) return false;
  if (!h.update(40000,true,37,37.5f)) return false;
  h.reset(40001); // sensor protection must keep the restart delay
  if (h.update(70000,true,37,37.5f)) return false;
  if (!h.update(70001,true,37,37.5f)) return false;
  return !h.update(70002,false,39,37.5f);
}
static_assert(rapidCyclingAndReset(), "30-second automatic restart delay and immediate safety OFF");

constexpr bool qualifiedCoolingFilter() {
  ThermalSafety s; RelayThermostat h; h.reset(0);
  s.sample(0,true,37.5f); s.sample(5000,true,37.5f); s.sample(10000,true,37.5f);
  if (h.update(10000,s.heatAllowed(10000),s.controlTemperature(),37.5f)) return false;
  s.sample(15000,true,36.9f); // valid temperature change, not a disconnected sensor
  if (!s.ready(15000) || h.update(15000,s.heatAllowed(15000),s.controlTemperature(),37.5f)) return false;
  s.sample(20000,true,36.9f);
  if (!h.update(20000,s.heatAllowed(20000),s.controlTemperature(),37.5f)) return false;
  s.sample(25000,true,37.9f); // raw hot value must bypass downward smoothing
  if (!s.ready(25000) || s.controlTemperature()!=37.9f || h.update(25000,s.heatAllowed(25000),s.controlTemperature(),37.5f)) return false;
  s.sample(30000,false,0);
  if (!s.ready(30000) || s.sampleMs!=25000) return false;
  s.sample(35000,true,39);
  return s.critical && !s.heatAllowed(35000);
}
static_assert(qualifiedCoolingFilter(), "Cold dip filtering, valid steps retain qualification, raw hot/critical OFF");
