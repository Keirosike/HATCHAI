#pragma once

#include <Arduino.h>
#include "Config.h"

struct SensorReading {
  float temperatureC = NAN;
  float humidityPercent = NAN;
  bool valid = false;
  uint32_t timestampMs = 0;
  String error = "No reading yet";
};

struct ControlSettings {
  bool autoMode = true;
  bool heaterOn = false;
  bool bulb2On = false;
  bool fanOn = false;
  bool turnerOn = false;
  float targetTemperatureC = HatchConfig::DefaultTargetTemperatureC;
  float targetHumidityPercent = HatchConfig::DefaultTargetHumidityPercent;
  uint16_t turnIntervalMinutes = HatchConfig::DefaultTurnIntervalMinutes;
};

struct EggTurningMetrics {
  uint32_t totalTurns = 0;
  uint16_t turnsToday = 0;
  uint16_t actualTurnIntervalMinutes = 0;
  String lastTurnTimestamp = "None";
};
