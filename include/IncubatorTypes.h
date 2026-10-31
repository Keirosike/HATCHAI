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
  bool fanOn = true;
  bool turnerOn = false;
  bool turner2On = false;
  float targetTemperatureC = HatchConfig::DefaultTargetTemperatureC;
  float targetHumidityPercent = HatchConfig::DefaultTargetHumidityPercent;
  uint16_t turnIntervalMinutes = HatchConfig::DefaultTurnIntervalMinutes;
  uint16_t turnInterval2Minutes = HatchConfig::DefaultTurnIntervalMinutes;
  uint16_t turnDurationSeconds = HatchConfig::TurnerPulseMs / 1000;
  uint16_t turnDuration2Seconds = HatchConfig::TurnerPulseMs / 1000;
  float temperatureOffsetC = 0;
};

struct EggTurningMetrics {
  uint32_t totalTurns = 0;
  uint16_t turnsToday = 0;
  uint16_t actualTurnIntervalMinutes = 0;
  String lastTurnTimestamp = "None";
};
