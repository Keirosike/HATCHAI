#include "IncubatorController.h"
#include "JsonBuilder.h"
#include "BatchDisplay.h"
#include <Preferences.h>
#include "hatchai_random_forest_esp32_final.h"

namespace {
Eloquent::ML::Port::RandomForestRegressor hatchModel;
const char* TurnMetricsNamespaces[] = {"hatchai-turn", "hatchai-turn2"};
constexpr int ChickenIncubationDays = 21;
uint32_t localEpoch(const String& iso) {
  if(iso.length()!=19 || iso[4]!='-' || iso[7]!='-' || iso[10]!='T' || iso[13]!=':' || iso[16]!=':') return 0;
  for(uint8_t i=0;i<19;++i) if(i!=4 && i!=7 && i!=10 && i!=13 && i!=16 && (iso[i]<'0'||iso[i]>'9')) return 0;
  return HatchCalendar::epoch(iso.substring(0,4).toInt(),iso.substring(5,7).toInt(),iso.substring(8,10).toInt(),
    iso.substring(11,13).toInt(),iso.substring(14,16).toInt(),iso.substring(17,19).toInt());
}
}

IncubatorController::IncubatorController(
  Dht22Sensor& sensor,
  OutputDevice& heater,
  OutputDevice& fan,
  OutputDevice& turner,
  OutputDevice& turner2,
  RealTimeClock& clock,
  DataLogger& logger,
  LcdStatusDisplay& display
) : _sensor(sensor),
    _heater(heater),
    _fan(fan),
    _turner(turner),
    _turner2(turner2),
    _clock(clock),
    _logger(logger),
    _display(display) {}

void IncubatorController::initializeOutputs() {
  if(_outputsInitialized) return;
  _heater.begin();
  _fan.begin();
  _turner.begin();
  _turner2.begin();
  _fan.set(true);
  _outputsInitialized=true;
}
void IncubatorController::begin() {
  _startedMs = millis();
  _recoveryLoadStartedMs = _startedMs;
  initializeOutputs();
  _heaterControl.reset(_startedMs);
  _motorOffMs[0] = _motorOffMs[1] = _startedMs;
  _profile.begin();
  _recoveryGuard.begin();
  _batchTurnCounter.begin();
  if(_profile.healthy && _recoveryGuard.healthy && _profile.rollerMappingChanged) {
    // Durable position holds precede accepting a different physical relay map.
    _recoveryGuard.value.uncertainMask|=3;
    _recoveryState.motors[0].positionHold=_recoveryState.motors[1].positionHold=true;
    if(_recoveryGuard.save()) _profile.acceptRollerMapping();
  }
  if (_profile.healthy) {
    const DeviceProfile& p = _profile.value;
    _settings.autoMode = (p.flags&8)==0;
    _settings.targetTemperatureC = p.temperature;
    _settings.targetHumidityPercent = p.humidity;
    _settings.temperatureOffsetC = p.calibration;
    _settings.turnIntervalMinutes = p.interval[0];
    _settings.turnInterval2Minutes = p.interval[1];
    _settings.turnDurationSeconds = p.duration[0];
    _settings.turnDuration2Seconds = p.duration[1];
    _safety.critical = (p.flags & 1) != 0;
  }
  _clock.begin();
  loadTurnMetrics(0);
  loadTurnMetrics(1);
  _logger.begin();
  _display.begin();
  _sensor.begin();
  _watchdog.begin();
  if (_profile.healthy && ((_watchdog.recoveryRequired && _watchdog.reason!=ESP_RST_BROWNOUT) || (_profile.value.flags & 4))) {
    _watchdog.recoveryRequired = true;
    if (!(_profile.value.flags & 4)) { _profile.value.flags |= 4; persistProfile(); }
  }
}

void IncubatorController::update() {
  const uint32_t nowMs = millis();

  updateTurnerPulse(nowMs);
  _clock.update();
  _safety.update(millis(), _startedMs);
  if (!_safety.sensorValid && _currentReading.valid) {
    _currentReading.valid = false;
    _currentReading.error = "DHT22 reading is stale";
  }
  refreshTurnMetricsDate(0);
  refreshTurnMetricsDate(1);
  readSensorIfDue(nowMs);
  updateRecovery(millis());
  recoverInterruptedRollers();
  // Recover reset-only holds automatically; never clear a critical heat alarm.
  if (_watchdog.recoveryRequired && _profile.healthy && _watchdog.healthy &&
      _safety.ready(millis()) && !_safety.critical) {
    _profile.value.flags &= ~4UL;
    if (persistProfile()) {
      _watchdog.recoveryRequired = false;
      logSystem("RESET_RECOVERED", "Stable sensor readings; restart hold cleared automatically");
    }
  }
  updateOutputs(millis());
  refreshDisplayIfDue(millis());
}

void IncubatorController::setNetworkStatus(const String& status) {
  _networkStatus = status;
}

bool IncubatorController::applySettings(const ControlSettings& settings) {
  if(_settings.autoMode && settings.autoMode && (settings.heaterOn!=_settings.heaterOn ||
      settings.fanOn!=_settings.fanOn || settings.turnerOn || settings.turner2On)) return false;
  if (!(settings.targetTemperatureC >= 30 && settings.targetTemperatureC <= 37.8f) ||
      !(settings.targetHumidityPercent >= 0 && settings.targetHumidityPercent <= 100) ||
      !(settings.temperatureOffsetC >= -2 && settings.temperatureOffsetC <= 2) ||
      settings.turnIntervalMinutes < 30 || settings.turnIntervalMinutes > 360 ||
      settings.turnInterval2Minutes < 30 || settings.turnInterval2Minutes > 360 ||
      settings.turnDurationSeconds < 1 || settings.turnDurationSeconds > 600 ||
      settings.turnDuration2Seconds < 1 || settings.turnDuration2Seconds > 600 || !_profile.healthy) return false;
  const bool modeChanged = settings.autoMode != _settings.autoMode;
  const bool resetHeating = modeChanged ||
    settings.targetTemperatureC != _settings.targetTemperatureC ||
    settings.temperatureOffsetC != _settings.temperatureOffsetC;
  const bool calibrationChanged = settings.temperatureOffsetC != _settings.temperatureOffsetC;
  if (modeChanged) stopTurnCycle();
  DeviceProfile previous = _profile.value;
  _settings = settings;
  if (modeChanged) { _settings.heaterOn=false; _settings.fanOn=true; }
  DeviceProfile& p = _profile.value;
  p.flags=(p.flags&~8UL) | (settings.autoMode ? 0 : 8) | 16;
  if(settings.autoMode && (_profile.value.active[0] || _profile.value.active[1])) p.flags|=2;
  p.temperature = settings.targetTemperatureC; p.humidity = settings.targetHumidityPercent;
  p.calibration = settings.temperatureOffsetC;
  p.interval[0] = settings.turnIntervalMinutes; p.interval[1] = settings.turnInterval2Minutes;
  p.duration[0] = settings.turnDurationSeconds; p.duration[1] = settings.turnDuration2Seconds;
  if (memcmp(&previous, &p, sizeof(p)) != 0 && !persistProfile()) return false;
  if (calibrationChanged) { _safety.invalidate(); _currentReading.valid = false; }
  if (resetHeating || (!_settings.autoMode && !_settings.heaterOn)) forceHeaterOff(millis());
  requestStateSave();
  // Legacy switches request bounded timed runs; continuous motor ON is removed.
  if (!settings.autoMode && settings.turnerOn) triggerTurnCycle(1, p.duration[0] * 1000UL);
  if (!settings.autoMode && settings.turner2On) triggerTurnCycle(2, p.duration[1] * 1000UL);
  _settings.turnerOn = _settings.turner2On = false;
  updateOutputs(millis());
  return true;
}

bool IncubatorController::triggerTurnCycle(uint8_t motor, uint32_t pulseMs, bool manual) {
  if (motor > 2 || pulseMs < HatchConfig::MinManualTurnSeconds * 1000UL ||
      pulseMs > HatchConfig::MaxManualTurnSeconds * 1000UL) {
    return false;
  }
  if(manual && _settings.autoMode) return false;
  const uint32_t nowMs = millis();
  // A Both request is accepted only if both rollers can start; never silently run half.
  if(!motor) for(uint8_t i=0;i<2;++i)
    if(!(manual || !_settings.autoMode ? manualMotorAllowed(i,nowMs) : motorAllowed(i,nowMs)) ||
        _turnCycles[i].active || _queuedMotor[i]) return false;
  bool accepted = false;
  for (uint8_t index = 0; index < 2; ++index) {
    if ((motor == 0 || motor == index + 1) && (manual || !_settings.autoMode ? manualMotorAllowed(index, nowMs) : motorAllowed(index, nowMs)) &&
        !_turnCycles[index].active && !_queuedMotor[index]) {
      _queuedMotor[index] = true; _queuedManual[index]=manual || !_settings.autoMode;
      _queuedPulseMs[index] = pulseMs; accepted = true;
    }
  }
  maybeStartScheduledTurn(nowMs);
  return accepted;
}

void IncubatorController::stopTurnCycle(uint8_t motor) {
  for (uint8_t index = 0; index < 2; ++index) {
    if (motor != 0 && motor != index + 1) continue;
    const bool interrupted=_turnCycles[index].active || _preparingMotor==index;
    motorOutput(index).set(false); // OFF precedes logging and all persistent work
    if (interrupted) {
      _motorOffMs[index] = millis(); if(_preparingMotor==index) _preparingMotor=-1;
      _recoveryState.motors[index].transaction=HatchRecovery::Transaction::Interrupted;
      _recoveryState.motors[index].positionHold=true;
      logMotor(index,"stopped_position_unknown"); requestStateSave();
    }
    _turnCycles[index].active = false; _queuedMotor[index] = false; _manualMotor[index] = false; _queuedManual[index]=false;
    if (index == 0) _settings.turnerOn = false;
    else _settings.turner2On = false;
    motorOutput(index).set(false);
  }
}

ControlSettings IncubatorController::settings() const {
  // Form updates must retain manual requests, not latch a timed pulse ON.
  ControlSettings current = _settings;
  return current;
}

String IncubatorController::buildStatusJson(
  const String& wifiStatus,
  const String& ipAddress
) const {
  const bool valid = _currentReading.valid;
  const bool heatingOn = _heater.isOn();
  const bool motorsOn = _turner.isOn() || _turner2.isOn();
  const uint32_t nowMs = millis();
  const uint32_t nextTurnMs = min(nextTurnInMs(nowMs, 0), nextTurnInMs(nowMs, 1));
  const int hatchDay = predictedHatchDay();
  const int daysRemaining = predictedDaysRemaining();
  const String predictedDate = predictedHatchDateIso();
  const String rtcTime = _clock.timestamp();

  String json = "{";
  json += "\"temperature\":";
  json += valid ? HatchJson::number(_currentReading.temperatureC, 1) : String("null");
  json += ",";
  json += "\"humidity\":";
  json += valid ? HatchJson::number(_currentReading.humidityPercent, 0) : String("null");
  json += ",";
  json += "\"relayStatus\":";
  json += HatchJson::quote(heatingOn ? "Heating ON" : "Heating OFF");
  json += ",";
  json += "\"relayBadge\":";
  json += HatchJson::quote(heatingOn ? "Bulb Active" : "Bulb Idle");
  json += ",";
  json += "\"relayOn\":";
  json += HatchJson::boolValue(heatingOn);
  json += ",";
  json += "\"motorStatus\":";
  json += HatchJson::quote(motorsOn ? "Turning" : "Idle");
  json += ",";
  json += "\"motorNote\":";

  if (motorsOn) {
    json += HatchJson::quote(
      _turner.isOn() && _turner2.isOn() ? "Both batch turners are ON" :
      _turner.isOn() ? "Batch 1 egg turner is ON" : "Batch 2 egg turner is ON"
    );
  } else if (_settings.autoMode && (motorAllowed(0, nowMs) || motorAllowed(1, nowMs))) {
    json += HatchJson::quote(String("Next egg turning in ") + formatDuration(nextTurnMs));
  } else {
    json += HatchJson::quote(turnState(0) + " / " + turnState(1));
  }

  json += ",";
  json += "\"predictedDay\":";
  json += HatchJson::quote(
    daysRemaining > 0
      ? String(daysRemaining) + " days remaining"
      : hatchDay > 0 ? "Hatch due" : "Waiting for data"
  );
  json += ",";
  json += "\"predictedDaysRemaining\":";
  json += String(daysRemaining);
  json += ",";
  json += "\"predictedHatchDay\":";
  json += String(hatchDay);
  json += ",";
  json += "\"incubationDay\":";
  json += String(incubationDay());
  json += ",";
  json += "\"hatchDate\":";
  json += HatchJson::quote(predictedDate.length() > 0 ? String("Predicted hatch date: ") + predictedDate : "Waiting for sensor and RTC data");
  json += ",";
  json += "\"predictionStatus\":";
  json += HatchJson::quote(hatchDay > 0 ? "random_forest_ready" : "waiting_for_data");
  json += ",";
  json += "\"clockStatus\":";
  json += HatchJson::quote(rtcTime == "RTC unavailable" && _clock.isReady()
    ? String("Read failed") : _clock.statusText());
  json += ",";
  json += "\"clockSyncNeeded\":"+HatchJson::boolValue(_clock.needsSync())+",";
  json += "\"rtcTime\":";
  json += HatchJson::quote(rtcTime);
  json += ",";
  json += "\"sdStatus\":";
  json += HatchJson::quote(_logger.statusText());
  json += ",";
  json += "\"lcdStatus\":";
  json += HatchJson::quote(_display.statusText());
  json += ",";
  json += "\"lastUpdated\":";
  json += HatchJson::quote(_lastReadingTimestamp);
  json += ",";
  json += "\"summaryTemp\":";
  json += HatchJson::quote(temperatureSummary());
  json += ",";
  json += "\"summaryHumidity\":";
  json += HatchJson::quote(humiditySummary());
  json += ",";
  json += "\"summaryRelay\":";
  json += HatchJson::quote(_settings.autoMode ? "Automatic" : "Manual");
  json += ",";
  json += "\"summaryTurning\":";
  json += HatchJson::quote(!(_profile.value.flags & 2) ? "Disabled" : _settings.autoMode ? "Scheduled" : "Manual");
  json += ",";
  json += "\"lastTurn\":";
  json += HatchJson::quote(_turningMetrics[0].lastTurnTimestamp);
  json += ",";
  json += "\"totalTurns\":";
  json += String(_turningMetrics[0].totalTurns);
  json += ",";
  json += "\"turnsToday\":";
  json += String(_turningMetrics[0].turnsToday);
  json += ",";
  json += "\"actualTurnIntervalMinutes\":";
  json += String(_turningMetrics[0].actualTurnIntervalMinutes);
  json += ",\"lastTurn2\":" + HatchJson::quote(_turningMetrics[1].lastTurnTimestamp);
  json += ",\"totalTurns2\":" + String(_turningMetrics[1].totalTurns);
  json += ",\"turnsToday2\":" + String(_turningMetrics[1].turnsToday);
  json += ",\"actualTurnInterval2Minutes\":" + String(_turningMetrics[1].actualTurnIntervalMinutes);
  json += ",";
  json += "\"lastAnomaly\":";
  json += HatchJson::quote(_lastAnomaly);
  json += ",";
  json += "\"sensorStatus\":";
  json += HatchJson::quote(valid ? "Connected" : "No reading");
  json += ",\"sensorValid\":" + HatchJson::boolValue(valid);
  json += ",\"sensorError\":" + HatchJson::quote(
    valid ? (_lastAnomaly == "None" ? String("") : _lastAnomaly) : _currentReading.error
  );
  json += ",\"sensorRetrying\":" + HatchJson::boolValue(_sensorFailureCount>0);
  json += ",\"sensorConsecutiveFailures\":" + String(_sensorFailureCount);
  json += ",\"sensorAgeSeconds\":";
  json += valid ? String((nowMs - _currentReading.timestampMs) / 1000) : String("null");
  json += ",";
  json += "\"wifiStatus\":";
  json += HatchJson::quote(wifiStatus);
  json += ",";
  json += "\"ipAddress\":";
  json += HatchJson::quote(ipAddress);
  json += ",\"firmwareBuild\":";
  json += HatchJson::quote(String(__DATE__) + " " + __TIME__);
  json += ",\"relayPins\":{\"bulb\":" + String(_heater.pin());
  json += ",\"fan\":" + String(_fan.pin());
  json += ",\"turner\":" + String(_turner.pin());
  json += ",\"turner2\":" + String(_turner2.pin());
  json += "}";
  json += ",";
  json += "\"history\":";
  json += _history.toJson();
  json += ",";
  json += "\"control\":{";
  json += "\"autoMode\":";
  json += HatchJson::boolValue(_settings.autoMode);
  json += ",";
  json += "\"bulbOn\":";
  json += HatchJson::boolValue(heatingOn);
  json += ",";
  json += "\"bulb1On\":";
  json += HatchJson::boolValue(_heater.isOn());
  json += ",";
  json += "\"bulb2On\":";
  json += HatchJson::boolValue(false); // Legacy field: no second heating relay.
  json += ",";
  json += "\"fanOn\":";
  json += HatchJson::boolValue(_fan.isOn());
  json += ",\"heaterStatus\":" + HatchJson::quote(heaterStatus());
  json += ",\"heaterControl\":\"thermostat_hysteresis\"";
  json += ",\"heaterControlTemperature\":" + (_safety.ready(nowMs) ? HatchJson::number(_safety.controlTemperature(),2) : String("null"));
  json += ",\"heaterAutomaticRestartSeconds\":" + String(HatchConfig::HeaterAutomaticRestartMs/1000);
  json += ",\"heaterDutyPercent\":";
  json += "null"; // Legacy field: thermostat has no PID duty percentage.
  json += ",\"heaterCycleSeconds\":0";
  json += ",\"heaterOnBelow\":" + HatchJson::number(_settings.targetTemperatureC-HatchConfig::HeaterHysteresisC,1);
  json += ",\"heaterOffAbove\":" + HatchJson::number(_settings.targetTemperatureC+HatchConfig::HeaterHysteresisC,1);
  json += ",\"manualFanOn\":" + HatchJson::boolValue(_settings.fanOn);
  json += ",\"manualBulbOn\":" + HatchJson::boolValue(_settings.heaterOn);
  json += ",\"turnDurationSeconds\":" + String(_settings.turnDurationSeconds);
  json += ",\"turnDuration2Seconds\":" + String(_settings.turnDuration2Seconds);
  json += ",\"temperatureOffset\":" + HatchJson::number(_settings.temperatureOffsetC, 2);
  json += ",\"turnQueued\":" + HatchJson::boolValue(_queuedMotor[0] || _preparingMotor==0);
  json += ",\"turn2Queued\":" + HatchJson::boolValue(_queuedMotor[1] || _preparingMotor==1);
  json += ",";
  json += "\"turnerOn\":";
  json += HatchJson::boolValue(_turner.isOn());
  json += ",\"turner2On\":" + HatchJson::boolValue(_turner2.isOn());
  json += ",\"manualTurnerOn\":" + HatchJson::boolValue(_settings.turnerOn);
  json += ",\"manualTurner2On\":" + HatchJson::boolValue(_settings.turner2On);
  json += ",\"turnPulseSeconds\":" + String(HatchConfig::TurnerPulseMs / 1000);
  json += ",\"manualTurnMinSeconds\":" + String(HatchConfig::MinManualTurnSeconds);
  json += ",\"manualTurnMaxSeconds\":" + String(HatchConfig::MaxManualTurnSeconds);
  json += ",\"turnPulseActive\":" + HatchJson::boolValue(_turnCycles[0].active);
  json += ",\"turnPulse2Active\":" + HatchJson::boolValue(_turnCycles[1].active);
  json += ",\"turnPulseRemainingSeconds\":" + String((_turnCycles[0].pulseRemainingMs(nowMs) + 999) / 1000);
  json += ",\"turnPulse2RemainingSeconds\":" + String((_turnCycles[1].pulseRemainingMs(nowMs) + 999) / 1000);
  json += ",";
  json += "\"targetTemperature\":";
  json += HatchJson::number(_settings.targetTemperatureC, 1);
  json += ",";
  json += "\"targetHumidity\":";
  json += HatchJson::number(_settings.targetHumidityPercent, 0);
  json += ",";
  json += "\"turnIntervalMinutes\":";
  json += String(_settings.turnIntervalMinutes);
  json += ",\"turnInterval2Minutes\":" + String(_settings.turnInterval2Minutes);
  json += "},\"safety\":" + buildSafetyJson() + ",\"recovery\":"+buildRecoveryJson()+"}";

  return json;
}

String IncubatorController::buildPredictionJson(
  const String& batchId,
  int incubationDay
) const {
  String json = "{";
  json += "\"success\":";

  // Saved NVS dates and trusted RTC determine age independently of SD logging.
  // A browser cannot override the day of a device-bound batch.
  for(uint8_t i=0;i<2;++i) if(batchId.length() && batchId==_profile.value.batchId[i]) {
    const uint32_t day=_profile.healthy && _clock.isReady() ?
      HatchRecovery::dayFromStart(_profile.value.start[i],_clock.epoch()) : 0;
    if(!day) {
      return "{\"success\":false,\"batchId\":"+HatchJson::quote(batchId)+
        ",\"predictionStatus\":\"rtc_or_start_unavailable\",\"message\":\"Prediction needs a trusted RTC and a valid saved batch start time that has already passed.\"}";
    }
    incubationDay=day;
  }

  if (!isValidIncubationDay(incubationDay)) {
    json += HatchJson::boolValue(false);
    json += ",";
    json += "\"batchId\":";
    json += HatchJson::quote(batchId);
    json += ",";
    json += "\"incubationDay\":";
    json += String(incubationDay);
    json += ",";
    json += "\"predictionStatus\":";
    json += HatchJson::quote("invalid_start_date");
    json += ",";
    json += "\"message\":";
    json += HatchJson::quote("Prediction unavailable - invalid or missing start date");
    json += "}";
    return json;
  }

  if (!hasPredictionSensorReading()) {
    json += HatchJson::boolValue(false);
    json += ",";
    json += "\"batchId\":";
    json += HatchJson::quote(batchId);
    json += ",";
    json += "\"incubationDay\":";
    json += String(clampIncubationDay(incubationDay));
    json += ",";
    json += "\"predictionStatus\":";
    json += HatchJson::quote("no_valid_sensor_reading");
    json += ",";
    json += "\"message\":";
    json += HatchJson::quote("Prediction unavailable - no valid sensor reading");
    json += "}";
    return json;
  }

  const int batchIncubationDay = clampIncubationDay(incubationDay);
  const int daysRemaining = predictedDaysRemainingForDay(batchIncubationDay);
  const int predictedHatchDay = daysRemaining > 0
    ? batchIncubationDay + daysRemaining
    : 0;
  const DateTimeValue now = _clock.now();
  const bool rtcAvailable = _clock.isReady() && now.valid;
  const DateTimeValue hatchDate = rtcAvailable
    ? addDays(now, daysRemaining)
    : DateTimeValue();

  json += HatchJson::boolValue(true);
  json += ",";
  json += "\"batchId\":";
  json += HatchJson::quote(batchId);
  json += ",";
  json += "\"incubationDay\":";
  json += String(batchIncubationDay);
  json += ",";
  json += "\"requestedIncubationDay\":";
  json += String(incubationDay);
  json += ",";
  json += "\"daysRemaining\":";
  json += String(daysRemaining);
  json += ",";
  json += "\"predictedHatchDay\":";
  json += String(predictedHatchDay);
  json += ",";
  json += "\"predictedHatchDate\":";
  json += HatchJson::quote(rtcAvailable ? dateIso(hatchDate) : "");
  json += ",";
  json += "\"rtcAvailable\":";
  json += HatchJson::boolValue(rtcAvailable);
  json += ",";
  json += "\"dateSource\":";
  json += HatchJson::quote(rtcAvailable ? "rtc" : "fallback_required");
  json += ",";
  json += "\"predictionStatus\":";
  json += HatchJson::quote(predictedHatchDay > 0 ? "random_forest_ready" : "waiting_for_data");
  json += "}";

  return json;
}

bool IncubatorController::hasElapsed(
  uint32_t nowMs,
  uint32_t previousMs,
  uint32_t intervalMs
) const {
  return nowMs - previousMs >= intervalMs;
}

void IncubatorController::readSensorIfDue(uint32_t nowMs) {
  if (!_sensorSampling.due(nowMs)) return;

  SensorReading reading = _sensor.read();
  if (isfinite(reading.temperatureC)) reading.temperatureC += _settings.temperatureOffsetC;
  if (!(reading.temperatureC >= -40 && reading.temperatureC <= 80)) {
    if (reading.valid) reading.error = "Calibrated temperature is outside permitted range";
    reading.valid = false;
  }
  if (reading.valid) _sensorFailureCount=0;
  else if (_sensorFailureCount<255) ++_sensorFailureCount;
  // Space retries from the completed transaction, including failed checks.
  _sensorSampling.completed(millis(), reading.valid);
  const bool wasCritical = _safety.critical;
  const bool wasValid = _currentReading.valid;
  const bool wasHigh = _safety.high;
  _safety.sample(reading.timestampMs, reading.valid, reading.temperatureC);
  if (!_safety.heatAllowed(millis())) forceHeaterOff(millis());
  if (!wasCritical && _safety.critical) {
    stopTurnCycle(); _profile.value.flags |= 1; persistProfile();
    logSystem("CRITICAL_TEMPERATURE","Persistent heater and motor lockout");
  }
  if(wasHigh!=_safety.high) logSystem("HIGH_TEMPERATURE",_safety.high?"alarm":"cleared");
  if(wasValid!=reading.valid || (!reading.valid && reading.error!=_lastAnomaly))
    logSystem(reading.valid?"SENSOR_RECOVERED":"SENSOR_FAULT",reading.valid?"Valid DHT22 sample":reading.error);

  if (reading.valid) {
    _lastReadingTimestamp = _clock.isReady() ? _clock.timestamp() : formatUptime(reading.timestampMs);
    _currentReading = reading;
    _history.add(reading);
    _logger.logReading(
      _lastReadingTimestamp,
      reading,
      _settings,
      _turningMetrics[0],
      _turningMetrics[1],
      _heater.isOn(),
      _fan.isOn(),
      _turner.isOn(),
      _turner2.isOn()
    );
    _lastAnomaly = "None";
    return;
  }

  if (!_safety.sensorValid) _currentReading = reading;
  _lastAnomaly = reading.error;
}

void IncubatorController::updateOutputs(uint32_t nowMs) {
  updateTurnerPulse(nowMs);

  updateAutomaticOutputs(nowMs);
  maybeStartScheduledTurn(nowMs);
}

void IncubatorController::updateAutomaticOutputs(uint32_t nowMs) {
  _heater.set(_heaterControl.update(
    nowMs, systemReady() && _safety.heatAllowed(nowMs),
    _safety.controlTemperature(), _settings.targetTemperatureC, _settings.autoMode, _settings.heaterOn
  ));
  _fan.set(_settings.autoMode || _settings.fanOn || _heater.isOn() || !_safety.ready(nowMs) ||
    _safety.inhibited || _safety.high || _safety.critical);
}

void IncubatorController::updateTurnerPulse(uint32_t nowMs) {
  for (uint8_t index = 0; index < 2; ++index) {
    if(!_turnCycles[index].active) continue;
    if(!(_manualMotor[index] ? manualMotorAllowed(index,nowMs) : motorAllowed(index,nowMs))) stopTurnCycle(index+1);
    else if(_turnCycles[index].pulseExpired(nowMs,_turnCycles[index].pulseDurationMs)) {
      if (_manualMotor[index]) finishManualMotor(index);
      else finishMotor(index);
    }
  }
}

void IncubatorController::maybeStartScheduledTurn(uint32_t nowMs) {
  if(!_settings.autoMode) {
    uint8_t mask=0;
    for(uint8_t i=0;i<2;++i) if(_queuedMotor[i] && !_turnCycles[i].active) {
      if(!manualMotorAllowed(i,nowMs)) { _queuedMotor[i]=_queuedManual[i]=false; continue; }
      if(HatchTurning::canStart(false,nowMs,_motorOffMs[i])) mask|=1<<i;
    }
    if(mask) startManualMotors(mask);
    return;
  }
  // SD intent writes are serialized; an already running peer may continue.
  if(_checkpointTicket || _preparingMotor>=0 || _checkpointFault) return;
  const uint32_t epoch = _clock.epoch();
  for (uint8_t attempt = 0; attempt < 2; ++attempt) {
    const uint8_t index = (_preferredMotor + attempt) % 2;
    if(!HatchTurning::canStart(_turnCycles[index].active,nowMs,_motorOffMs[index])) continue;
    if (!motorAllowed(index, nowMs)) { _queuedMotor[index] = false; continue; }
    const bool due = epoch>=_resumeTurnsAfter && epoch>=_recoveryState.motors[index].next;
    if (_queuedMotor[index] || due) {
      const uint32_t duration = _queuedMotor[index] ? _queuedPulseMs[index] :
        _profile.value.duration[index] * 1000UL;
      _queuedMotor[index] = false;
      if (startMotor(index, duration)) _preferredMotor = 1 - index;
      return;
    }
  }
}

void IncubatorController::refreshDisplayIfDue(uint32_t nowMs) {
  if (
    _lastDisplayRefreshMs != 0 &&
    !hasElapsed(nowMs, _lastDisplayRefreshMs, HatchConfig::LcdRefreshIntervalMs)
  ) {
    return;
  }

  _lastDisplayRefreshMs = nowMs;
  const auto& p=_profile.value;
  const bool hasLower=_profile.healthy && p.batchId[0][0] &&
    (p.active[0] || _recoveryGuard.value.batchStatus[0]==uint8_t(HatchRecovery::BatchStatus::Paused));
  const bool hasUpper=_profile.healthy && p.batchId[1][0] &&
    (p.active[1] || _recoveryGuard.value.batchStatus[1]==uint8_t(HatchRecovery::BatchStatus::Paused));
  const bool shared=hasLower && hasUpper && strcmp(p.batchId[0],p.batchId[1])==0 && p.start[0]==p.start[1];
  const auto label=[this,&p](uint8_t i) -> String {
    const auto& b=_recoveryState.batches[i];
    return strcmp(b.id,p.batchId[i])==0 && b.start==p.start[i] && b.label[0] ? String(b.label) : String(p.batchId[i]);
  };
  const String lowerText="Lower: "+(hasLower ? label(0) : String("No batch"));
  const String upperText="Upper: "+(hasUpper ? label(1) : String("No batch"));
  String hatch="Est: No batch";
  const int selected=HatchDisplay::predictionMotor(hasLower,hasUpper,shared,nowMs/6000UL);
  if (selected>=0) {
    const String prefix=hasLower && hasUpper && !shared ? (selected ? "Est U:" : "Est L:") : "Est:";
    const int day=_clock.isReady() ? HatchRecovery::dayFromStart(p.start[selected],_clock.epoch()) : 0;
    hatch=prefix+(!_clock.isReady() ? " RTC not ready" : !day ? " Invalid start" : " Sensor missing");
    if (day>0 && hasPredictionSensorReading())
      hatch=prefix+dateIso(addDays(_clock.now(),predictedDaysRemainingForDay(day)));
  }
  _display.showStatus(
    _currentReading,
    upperText,
    lowerText,
    hatch,
    _safety.critical ? "CRITICAL: HEAT OFF" : !systemReady() ? "SAFETY HOLD" :
    !_safety.ready(nowMs) ? "SENSOR: HEAT OFF" : _safety.high ? "HIGH TEMP: HEAT OFF" :
    _safety.inhibited ? "COOLING: HEAT OFF" : _safety.low ? "LOW TEMP WARNING" : ""
  );
}

void IncubatorController::loadTurnMetrics(uint8_t index) {
  EggTurningMetrics& metrics = _turningMetrics[index];
  Preferences preferences;
  preferences.begin(TurnMetricsNamespaces[index], true);
  metrics.totalTurns = preferences.getULong("total", 0);
  metrics.turnsToday = preferences.getUShort("today", 0);
  metrics.actualTurnIntervalMinutes = preferences.getUShort("interval", 0);
  metrics.lastTurnTimestamp = preferences.getString("last", "None");
  _turnMetricsDateKey[index] = preferences.getString("date", "");
  preferences.end();

  refreshTurnMetricsDate(index);
}

void IncubatorController::persistTurnMetrics(uint8_t index) const {
  const EggTurningMetrics& metrics = _turningMetrics[index];
  Preferences preferences;
  preferences.begin(TurnMetricsNamespaces[index], false);
  preferences.putULong("total", metrics.totalTurns);
  preferences.putUShort("today", metrics.turnsToday);
  preferences.putUShort("interval", metrics.actualTurnIntervalMinutes);
  preferences.putString("last", metrics.lastTurnTimestamp);
  preferences.putString("date", _turnMetricsDateKey[index]);
  preferences.end();
}

void IncubatorController::refreshTurnMetricsDate(uint8_t index) {
  // Preserve persisted daily counts while the RTC validates after a restart.
  if (!_clock.isReady()) return;
  const String currentDateKey = turnDateKey();

  if (_turnMetricsDateKey[index] != currentDateKey) {
    _turnMetricsDateKey[index] = currentDateKey;
    _turningMetrics[index].turnsToday = 0;
    persistTurnMetrics(index);
  }
}

void IncubatorController::recordTurnEvent(uint32_t nowMs, uint8_t index) {
  if(_profile.value.batchId[index][0] && !_batchTurnCounter.completed(_profile.value.batchId[index],
      _profile.value.start[index],index,_recoveryGuard.value.serial[index]))
    logSystem("BATCH_TURN_COUNT_FAULT","Completed run count could not be verified in internal storage");
  refreshTurnMetricsDate(index);
  EggTurningMetrics& metrics = _turningMetrics[index];
  metrics.totalTurns++;
  metrics.turnsToday++;
  metrics.lastTurnTimestamp =
    _clock.isReady() ? _clock.timestamp() : formatUptime(nowMs);
  persistTurnMetrics(index);
}

String IncubatorController::turnDateKey() const {
  if (_clock.isReady()) {
    const DateTimeValue now = _clock.now();

    if (now.valid) {
      return String(now.year) + "-" +
        (now.month < 10 ? "0" : "") + String(now.month) + "-" +
        (now.day < 10 ? "0" : "") + String(now.day);
    }
  }

  return String("uptime-day-") + String((millis() - _startedMs) / 86400000UL);
}

int IncubatorController::incubationDay() const {
  if(!_recoveryReady || !_clock.isReady()) return 0;
  for(uint8_t i=0;i<2;++i) if(_recoveryState.batches[i].status==HatchRecovery::BatchStatus::Active)
    return int(HatchRecovery::day(_recoveryState.batches[i],_clock.epoch()));
  return 0;
}

int IncubatorController::predictedHatchDay() const {
  const int daysRemaining = predictedDaysRemaining();
  return daysRemaining > 0 ? incubationDay() + daysRemaining : 0;
}

int IncubatorController::predictedDaysRemaining() const {
  const int day=incubationDay(); return day>0 ? predictedDaysRemainingForDay(day) : 0;
}

int IncubatorController::predictedDaysRemainingForDay(int batchIncubationDay) const {
  if (!hasPredictionSensorReading()) {
    return 0;
  }

  const int modelIncubationDay = clampIncubationDay(batchIncubationDay);

  // Exported model contract: temperature, humidity, egg-turning state, incubation day.
  float features[] = {
    _currentReading.temperatureC,
    _currentReading.humidityPercent,
    _turner.isOn() ? 1.0f : 0.0f,
    static_cast<float>(modelIncubationDay)
  };

  const float prediction = hatchModel.predict(features);
  return prediction > 0.0f ? static_cast<int>(prediction + 0.5f) : 0;
}

String IncubatorController::predictedHatchDateText() const {
  const String iso = predictedHatchDateIso();

  if (iso.length() == 0) {
    const int daysRemaining = predictedDaysRemaining();

    if (daysRemaining > 0) {
      return String("Hatch: ") + String(daysRemaining) + "d";
    }

    if (predictedHatchDay() > 0) {
      return "Hatch: due";
    }

    return "Hatch: waiting";
  }

  return "Hatch: " + iso.substring(5);
}

String IncubatorController::predictedHatchDateIso() const {
  const int hatchDay = predictedHatchDay();

  if (hatchDay <= 0 || !_clock.isReady()) {
    return "";
  }

  const int daysRemaining = predictedDaysRemaining();
  const DateTimeValue now = _clock.now();

  if (!now.valid) {
    return "";
  }

  const DateTimeValue hatchDate = addDays(now, daysRemaining);

  return String(hatchDate.year) + "-" +
    (hatchDate.month < 10 ? "0" : "") + String(hatchDate.month) + "-" +
    (hatchDate.day < 10 ? "0" : "") + String(hatchDate.day);
}

bool IncubatorController::hasPredictionSensorReading() const {
  if (!_currentReading.valid) {
    return false;
  }

  if (isnan(_currentReading.temperatureC) || isnan(_currentReading.humidityPercent)) {
    return false;
  }

  return _currentReading.temperatureC >= -40.0f &&
    _currentReading.temperatureC <= 80.0f &&
    _currentReading.humidityPercent >= 0.0f &&
    _currentReading.humidityPercent <= 100.0f;
}

bool IncubatorController::isValidIncubationDay(int batchIncubationDay) const {
  return batchIncubationDay >= 1;
}

int IncubatorController::clampIncubationDay(int batchIncubationDay) const {
  if (batchIncubationDay < 1) {
    return 1;
  }

  if (batchIncubationDay > ChickenIncubationDays) {
    return ChickenIncubationDays;
  }

  return batchIncubationDay;
}

String IncubatorController::dateIso(const DateTimeValue& date) const {
  if (!date.valid) {
    return "";
  }

  return String(date.year) + "-" +
    (date.month < 10 ? "0" : "") + String(date.month) + "-" +
    (date.day < 10 ? "0" : "") + String(date.day);
}

DateTimeValue IncubatorController::addDays(const DateTimeValue& date, int days) const {
  DateTimeValue result = date;

  while (days > 0) {
    const uint8_t monthDays = daysInMonth(result.year, result.month);

    if (result.day < monthDays) {
      result.day++;
    } else {
      result.day = 1;

      if (result.month < 12) {
        result.month++;
      } else {
        result.month = 1;
        result.year++;
      }
    }

    days--;
  }

  return result;
}

uint8_t IncubatorController::daysInMonth(uint16_t year, uint8_t month) const {
  static const uint8_t monthDays[] = {
    31, 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31
  };

  if (month == 2) {
    const bool leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    return leap ? 29 : 28;
  }

  if (month < 1 || month > 12) {
    return 30;
  }

  return monthDays[month - 1];
}

String IncubatorController::temperatureSummary() const {
  if (!_currentReading.valid) {
    return "No Data";
  }

  if (_currentReading.temperatureC < _settings.targetTemperatureC - 0.5f) {
    return "Low";
  }

  if (_currentReading.temperatureC > _settings.targetTemperatureC + 0.5f) {
    return "High";
  }

  return "Stable";
}

String IncubatorController::humiditySummary() const {
  if (!_currentReading.valid) {
    return "No Data";
  }

  if (_currentReading.humidityPercent < _settings.targetHumidityPercent - 5.0f) {
    return "Low";
  }

  if (_currentReading.humidityPercent > _settings.targetHumidityPercent + 5.0f) {
    return "High";
  }

  return "Normal";
}

String IncubatorController::formatDuration(uint32_t durationMs) const {
  uint32_t minutes = (durationMs + 59999UL) / 60000UL;

  if (minutes == 0) {
    return "less than 1 min";
  }

  const uint32_t hours = minutes / 60;
  minutes %= 60;

  if (hours == 0) {
    return String(minutes) + " min";
  }

  if (minutes == 0) {
    return String(hours) + " hr";
  }

  return String(hours) + " hr " + String(minutes) + " min";
}

String IncubatorController::formatUptime(uint32_t timestampMs) const {
  const uint32_t totalSeconds = timestampMs / 1000;
  const uint32_t hours = totalSeconds / 3600;
  const uint32_t minutes = (totalSeconds % 3600) / 60;
  const uint32_t seconds = totalSeconds % 60;

  char buffer[16];
  snprintf(
    buffer,
    sizeof(buffer),
    "%02lu:%02lu:%02lu",
    static_cast<unsigned long>(hours),
    static_cast<unsigned long>(minutes),
    static_cast<unsigned long>(seconds)
  );

  return String(buffer);
}

OutputDevice& IncubatorController::motorOutput(uint8_t index) const {
  return index == 0 ? _turner : _turner2;
}

uint16_t IncubatorController::motorInterval(uint8_t index) const {
  return index == 0 ? _settings.turnIntervalMinutes : _settings.turnInterval2Minutes;
}

uint32_t IncubatorController::nextTurnInMs(uint32_t nowMs, uint8_t index) const {
  if (!motorAllowed(index, nowMs)) return 0;
  const uint32_t next=_recoveryState.motors[index].next, now=_clock.epoch();
  return next<=now ? 0 : min(uint32_t(21600),next-now)*1000UL;
}

void IncubatorController::forceHeaterOff(uint32_t nowMs) {
  _heater.set(false); _heaterControl.reset(nowMs);
}
bool IncubatorController::persistProfile() {
  if (_profile.save()) { requestStateSave(); return true; }
  forceHeaterOff(millis()); stopTurnCycle(); return false;
}
bool IncubatorController::systemReady() const {
  return _profile.healthy && _watchdog.healthy && !_watchdog.recoveryRequired;
}
void IncubatorController::completeLoop() {
  if (!_watchdog.feed()) { forceHeaterOff(millis()); stopTurnCycle(); _fan.set(true); }
}
bool IncubatorController::acknowledgeAlarm() {
  if (!_profile.healthy || !_recoveryGuard.healthy || !_recoveryReady || !_watchdog.healthy || !_safety.ready(millis()) ||
      _safety.lastTemperature > HatchConfig::HeaterResumeC) return false;
  const bool wasCritical = _safety.critical;
  if (!_safety.acknowledge(millis())) return false;
  _profile.value.flags &= ~5UL;
  if (!persistProfile()) { _safety.critical = wasCritical; return false; }
  _watchdog.recoveryRequired = false;
  forceHeaterOff(millis()); return true;
}
bool IncubatorController::setTurningArmed(bool armed) {
  if (!armed) {
    stopTurnCycle(); _profile.value.flags &= ~2UL; return persistProfile();
  }
  if (!systemReady() || _checkpointFault || _recoveryGuard.value.uncertainMask || !_logger.isReady() || !_safety.ready(millis()) || _safety.critical || !_clock.isReady() ||
      (!_profile.value.active[0] && !_profile.value.active[1])) return false;
  for (uint8_t i = 0; i < 2; ++i) {
    if (_profile.value.active[i] && (_profile.value.start[i] > _clock.epoch() ||
        _profile.value.reserved[i] > _clock.epoch())) return false;
  }
  _profile.value.flags |= 2; return persistProfile();
}
bool IncubatorController::setClock(const String& iso) {
  if (_profile.value.flags & 2) return false;
  if(iso.length()!=19) return false;
  const uint32_t proposed=HatchCalendar::epoch(iso.substring(0,4).toInt(),iso.substring(5,7).toInt(),iso.substring(8,10).toInt(),
    iso.substring(11,13).toInt(),iso.substring(14,16).toInt(),iso.substring(17,19).toInt());
  if(!proposed || proposed<_recoveryGuard.value.lastRtc || proposed<_startupEpoch) return false;
  stopTurnCycle(); forceHeaterOff(millis());
  const bool set=_clock.setIsoTime(iso); if(set) { _clockReviewed=true; requestStateSave(); logSystem("CLOCK_SET","Operator corrected local RTC time"); }
  return set;
}
bool IncubatorController::autoSyncClock(const String& iso) {
  if(_clock.isReady()) return true;
  if(_turnCycles[0].active || _turnCycles[1].active || _preparingMotor>=0) return false;
  const uint32_t stamp=localEpoch(iso);
  if(!stamp || stamp<_recoveryGuard.value.lastRtc || stamp<_startupEpoch || !_profile.healthy) return false;
  const uint32_t flags=_profile.value.flags;
  stopTurnCycle();
  _profile.value.flags&=~2UL;
  const bool ok=setClock(iso);
  _profile.value.flags=flags;
  if(ok) { _resumeTurnsAfter=stamp+HatchConfig::RecoveryResumeTurnDelaySeconds; persistProfile(); }
  return ok;
}
bool IncubatorController::bindBatch(uint8_t motor, const String& id, const String& date, bool active,
    const String& time,uint16_t durationDays,const String& status,const String& turningEnd) {
  if (!_profile.healthy || !_recoveryReady || motor < 1 || motor > 2 || id.length() > 48 || durationDays<19 || durationDays>35) return false;
  const uint8_t i = motor - 1;
  uint32_t start = 0;
  if (id.length()) {
    for(size_t p=0;p<id.length();++p) {
      const char c=id[p];
      if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='-'||c=='_'||c=='.'||c==':')) return false;
    }
    if (date.length() != 10 || date[4] != '-' || date[7] != '-') return false;
    for (uint8_t p = 0; p < 10; ++p)
      if (p != 4 && p != 7 && (date[p] < '0' || date[p] > '9')) return false;
    if(time.length()!=8 || time[2]!=':' || time[5]!=':') return false;
    for(uint8_t p=0;p<8;++p) if(p!=2 && p!=5 && (time[p]<'0' || time[p]>'9')) return false;
    start = HatchCalendar::epoch(date.substring(0,4).toInt(), date.substring(5,7).toInt(), date.substring(8,10).toInt(),
      time.substring(0,2).toInt(),time.substring(3,5).toInt(),time.substring(6,8).toInt());
    if (!start) return false;
    if (!_batchEditInProgress && id == String(_profile.value.batchId[1-i])) return false;
  }
  HatchRecovery::BatchStatus phase = id.length() ? active ? HatchRecovery::BatchStatus::Active : HatchRecovery::BatchStatus::Paused : HatchRecovery::BatchStatus::Empty;
  if(status.length()) {
    if(status=="Active") phase=HatchRecovery::BatchStatus::Active;
    else if(status=="Paused") phase=HatchRecovery::BatchStatus::Paused;
    else if(status=="Completed") phase=HatchRecovery::BatchStatus::Completed;
    else if(status=="Failed") phase=HatchRecovery::BatchStatus::Failed;
    else return false;
    if(active!=(phase==HatchRecovery::BatchStatus::Active)) return false;
  }
  const uint32_t stop=id.length() ? turningEnd.length() ? localEpoch(turningEnd) :
    (id==String(_profile.value.batchId[i]) && start==_profile.value.start[i] ? _profile.value.turningEnd[i] : 0) : 0;
  if(id.length() && ((turningEnd.length() && !stop) || (stop && (stop<start || stop>start+HatchConfig::LockdownAfterSeconds)))) return false;
  const bool changed = stop!=_profile.value.turningEnd[i] || id != String(_profile.value.batchId[i]) || start != _profile.value.start[i] || durationDays!=_recoveryState.batches[i].durationDays;
  const bool stateChanged = phase!=_recoveryState.batches[i].status;
  if (!changed && !stateChanged) return true;
  if (id.length() && (changed || active) && (!_clock.isReady() || start > _clock.epoch())) return false;
  stopTurnCycle(i + 1);
  // Changes to batch age require deliberate re-arming; no automatic motion on edit.
  if (changed) { stopTurnCycle(); _profile.value.flags &= ~2UL; }
  if (changed) {
    const auto previousBatch=_recoveryState.batches[i];
    id.toCharArray(_profile.value.batchId[i], sizeof(_profile.value.batchId[i]));
    _profile.value.start[i] = start;
    _profile.value.reserved[i] = start ? _clock.epoch() : 0;
    const bool positionHold=_recoveryState.motors[i].positionHold || (_recoveryGuard.value.uncertainMask&(1<<i));
    _recoveryState.batches[i]=HatchRecovery::Batch();
    if(id.length() && id==previousBatch.id) {
      strcpy(_recoveryState.batches[i].label,previousBatch.label);
      strcpy(_recoveryState.batches[i].name,previousBatch.name);
      _recoveryState.batches[i].eggCount=previousBatch.eggCount;
    }
    _recoveryState.motors[i]=HatchRecovery::Motor();
    _recoveryState.motors[i].positionHold=positionHold;
    if(start) {
      _recoveryState.motors[i].cycle=_recoveryGuard.value.serial[i];
      _recoveryState.motors[i].next=_clock.epoch()+uint32_t(motorInterval(i))*60;
    }
  }
  auto& batch=_recoveryState.batches[i];
  id.toCharArray(batch.id,sizeof(batch.id)); batch.start=start; batch.turningEnd=stop; batch.durationDays=durationDays; batch.status=phase;
  _profile.value.turningEnd[i]=stop;
  if(stateChanged && phase==HatchRecovery::BatchStatus::Active)
    _recoveryState.motors[i].next=_clock.epoch()+uint32_t(motorInterval(i))*60;
  _profile.value.active[i] = phase==HatchRecovery::BatchStatus::Active && id.length();
  _recoveryGuard.value.periodDays[i]=durationDays; _recoveryGuard.value.batchStatus[i]=uint8_t(phase);
  _seenLockdown[i]=start && _clock.epoch()>=HatchRecovery::lockdown(batch);
  logSystem("BATCH_STATE",String(motor)+"; "+HatchRecovery::batchText(phase));
  requestStateSave();
  return _batchEditInProgress || (persistProfile() && _recoveryGuard.save());
}
bool IncubatorController::updateBoundBatch(const String& id,const String& date,bool active,
    const String& time,uint16_t durationDays,const String& status,uint8_t roller,const String& turningEnd) {
  if(!id.length() || roller>3 || !_recoveryReady || _batchEditInProgress) return false;
  uint8_t current=0;
  for(uint8_t i=0;i<2;++i) if(id==String(_profile.value.batchId[i])) current|=1<<i;
  const uint8_t desired=roller ? roller : current;
  if(!desired) return true;
  for(uint8_t i=0;i<2;++i) if((desired&(1<<i)) && _profile.value.active[i] &&
      id!=String(_profile.value.batchId[i])) return false;
  const auto savedProfile=_profile.value; const auto savedState=_recoveryState; const auto savedGuard=_recoveryGuard.value;
  _batchEditInProgress=true;
  bool ok=true;
  for(uint8_t i=0;i<2 && ok;++i) if((current&(1<<i)) && !(desired&(1<<i))) ok=bindBatch(i+1,"","",false);
  for(uint8_t i=0;i<2 && ok;++i) if(desired&(1<<i)) ok=bindBatch(i+1,id,date,active,time,durationDays,status,turningEnd);
  _batchEditInProgress=false;
  if(!ok) { _profile.value=savedProfile; _recoveryState=savedState; _recoveryGuard.value=savedGuard; return false; }
  // Saving an active batch enables its schedule without a second setup button.
  // Sensor, cutoff, journal and verified SD checks still guard every start.
  if(active) _profile.value.flags|=2;
  requestStateSave(); return persistProfile() && _recoveryGuard.save();
}
bool IncubatorController::updateBatchMetadata(const String& id,const String& label,const String& name,uint16_t eggs) {
  if(label.length()>30 || name.length()>64 || eggs>1000) return false;
  for(uint8_t i=0;i<2;++i) if(id.length() && id==_recoveryState.batches[i].id) {
    auto& b=_recoveryState.batches[i]; label.toCharArray(b.label,sizeof(b.label)); name.toCharArray(b.name,sizeof(b.name));
    b.eggCount=eggs; requestStateSave();
  }
  return true;
}
bool IncubatorController::motorAllowed(uint8_t i, uint32_t nowMs) const {
  const DeviceProfile& p = _profile.value;
  const uint32_t epoch = _clock.epoch();
  const auto storage=_logger.storage().status();
  return systemReady() && _recoveryGuard.healthy && _recoveryReady && !_checkpointFault && HatchRecovery::journalAllows(_recoveryGuard.value.uncertainMask,i,_preparingMotor==i,_turnCycles[i].active) &&
    !_recoveryState.motors[i].positionHold && storage.available && storage.logging &&
    uint32_t(nowMs-storage.heartbeat)<=HatchConfig::RecoveryCommitTimeoutMs && _safety.ready(nowMs) && !_safety.critical && (p.flags & 2) &&
    p.active[i] && HatchTurning::ageAllowed(epoch, p.start[i], p.reserved[i],p.turningEnd[i]);
}
bool IncubatorController::manualMotorAllowed(uint8_t i, uint32_t nowMs) const {
  return !manualMotorHold(i,nowMs)[0];
}
const char* IncubatorController::manualMotorHold(uint8_t i, uint32_t nowMs) const {
  const auto& p=_profile.value;
  // Explicit bounded manual motion does not depend on SD, automatic arming,
  // or an unassigned roller's calendar. Durable NVS intent still precedes ON.
  if(_settings.autoMode) return "Switch to Manual mode before controlling a roller.";
  if(!_profile.healthy) return "ESP32 settings storage failed; service internal flash storage.";
  if(!_watchdog.healthy) return "ESP32 watchdog is unavailable; restart and check device status.";
  if(_watchdog.recoveryRequired) return "Restart recovery is waiting for stable sensor readings.";
  if(!_recoveryGuard.healthy) return "ESP32 motor journal failed; service internal flash storage.";
  if(_safety.critical) return "Critical temperature alarm; inspect and acknowledge after cooling in Settings > Component status.";
  if(!_safety.ready(nowMs)) return "DHT22 is not ready; wait for three stable valid readings and check its wiring if this continues.";
  if(!HatchRecovery::journalAllows(_recoveryGuard.value.uncertainMask,i,false,_manualMotor[i]) || _recoveryState.motors[i].positionHold)
    return _preparingMotor>=0 ? "Another automatic turn is being prepared; wait for it to finish." :
      "Interrupted turn recovery is pending; the unfinished run will be skipped automatically.";
  if(_recoveryGuard.value.serial[i]==UINT32_MAX && !_manualMotor[i]) return "Motor journal counter is full; service internal storage.";
  if(p.batchId[i][0]) {
    if(!p.active[i]) return "The assigned batch is paused or completed. Resume or replace it on the Batch page.";
    if(!_clock.isReady()) return "RTC time is unavailable; keep a logged-in browser connected for automatic time sync.";
    if(_clock.epoch()<p.start[i] || _clock.epoch()<p.reserved[i]) return "RTC time is earlier than the batch start or last turn. Check the clock and batch dates.";
    if(!HatchTurning::ageAllowed(_clock.epoch(),p.start[i],p.reserved[i],p.turningEnd[i]))
      return "The batch turning end has been reached; chicken turning stops by the start of day 18.";
  }
  return "";
}
String IncubatorController::manualTurnBlockedReason(uint8_t motor) const {
  for(uint8_t i=0;i<2;++i) if(!motor || motor==i+1) {
    const String label=i ? "Upper roller: " : "Lower roller: ";
    const char* hold=manualMotorHold(i,millis());
    if(hold[0]) return label+hold;
    if(_turnCycles[i].active || _queuedMotor[i]) return label+"already running or queued. Use Stop to cancel.";
  }
  return "Timed turn could not be queued. Refresh device status and retry.";
}
bool IncubatorController::startManualMotors(uint8_t mask) {
  if(!mask || mask>3) return false;
  for(uint8_t i=0;i<2;++i) if(mask&(1<<i))
    if(!manualMotorAllowed(i,millis()) || !HatchTurning::canStart(_turnCycles[i].active,millis(),_motorOffMs[i]) ||
        _recoveryGuard.value.serial[i]==UINT32_MAX) return false;
  // Both intents are durable in one NVS write before either output is energized.
  for(uint8_t i=0;i<2;++i) if(mask&(1<<i)) {
    ++_recoveryGuard.value.serial[i]; _recoveryGuard.value.uncertainMask|=1<<i;
  }
  if(!_recoveryGuard.save()) return false;
  const uint32_t started=millis();
  for(uint8_t i=0;i<2;++i) if(mask&(1<<i)) {
    _queuedMotor[i]=_queuedManual[i]=false; _manualMotor[i]=true;
    _turnCycles[i].start(started,_queuedPulseMs[i]); motorOutput(i).set(true);
  }
  for(uint8_t i=0;i<2;++i) if(mask&(1<<i)) logSystem("MANUAL_TURN_STARTED",String(i+1));
  return true;
}
void IncubatorController::finishManualMotor(uint8_t i) {
  motorOutput(i).set(false); _turnCycles[i].active=false; _manualMotor[i]=false; _motorOffMs[i]=millis();
  if (_recoveryReady && _profile.value.batchId[i][0]) {
    auto& m=_recoveryState.motors[i]; m.cycle=_recoveryGuard.value.serial[i];
    m.transaction=HatchRecovery::Transaction::Completed; m.issued=m.completed=_clock.epoch();
    m.lastSuccessfulCycle=m.cycle; m.next=m.completed+uint32_t(motorInterval(i))*60;
    _profile.value.reserved[i]=m.completed; persistProfile(); requestStateSave();
  }
  _recoveryGuard.value.uncertainMask&=~(1<<i);
  if (!_recoveryGuard.save()) _recoveryState.motors[i].positionHold=true;
  recordTurnEvent(millis(),i); logSystem("MANUAL_TURN_COMPLETED",String(i+1));
}
bool IncubatorController::startMotor(uint8_t i, uint32_t pulseMs) {
  if (!HatchTurning::canStart(_turnCycles[i].active, millis(), _motorOffMs[i]) ||
      !motorAllowed(i, millis())) return false;
  if(_checkpointTicket || _preparingMotor>=0 || _recoveryGuard.value.serial[i]==UINT32_MAX) return false;
  auto& m=_recoveryState.motors[i];
  m.cycle=++_recoveryGuard.value.serial[i]; m.issued=_clock.epoch();
  m.transaction=HatchRecovery::Transaction::Pending; m.next=m.issued+uint32_t(motorInterval(i))*60;
  _recoveryGuard.value.uncertainMask|=1<<i; _recoveryGuard.value.lastRtc=m.issued;
  if(!_recoveryGuard.save()) { forceHeaterOff(millis()); stopTurnCycle(); return false; }
  _profile.value.reserved[i]=m.issued;
  _preparingMotor=i; _preparingPulseMs=pulseMs;
  if(!persistProfile() || !requestCheckpoint(CommitPurpose::Pending)) { stopTurnCycle(i+1); return false; }
  logMotor(i,"durable_pending_requested"); return true;
}
String IncubatorController::heaterStatus() const {
  if (_safety.critical) return "Heater OFF: critical temperature alarm";
  if (!_profile.healthy) return "Heater OFF: internal settings storage fault";
  if (!_watchdog.healthy) return "Heater OFF: watchdog fault";
  if (_watchdog.recoveryRequired) return "Heater OFF: qualifying sensor after restart";
  if (!_safety.ready(millis())) return "Heater OFF: waiting for fresh, qualified DHT22 readings";
  if (_safety.inhibited || _safety.high) return "Heater OFF: cooling hold until at most 37.5 C";
  if (_heater.isOn()) return "Heating ON";
  if (!_settings.autoMode && !_settings.heaterOn) return "Manual bulb OFF";
  if (!_settings.autoMode || _safety.controlTemperature()<_settings.targetTemperatureC-HatchConfig::HeaterHysteresisC) {
    const uint32_t remaining=_heaterControl.restartRemainingMs(millis(),_settings.autoMode);
    if (remaining) return String("Heater OFF: relay restart delay, ") + String((remaining+999)/1000) + " s remaining";
  }
  return "Heater OFF: thermostat waiting for temperature to fall below the ON threshold";
}
String IncubatorController::safetyMessage() const {
  if (_safety.critical) return "Critical temperature alarm: heater and turners OFF. Acknowledge after cooling.";

  if (!_profile.healthy) return "Storage fault: heater and turners OFF. Service ESP32 storage.";
  if (!_watchdog.healthy) return "Watchdog fault: heater and turners OFF.";
  if (_watchdog.recoveryRequired) return "Heater OFF: restart recovery is waiting for stable sensor readings.";

  if (!_safety.ready(millis())) return "Heater OFF: waiting for three stable valid sensor readings.";
  if (_safety.high) return "High temperature alarm: heater OFF; fan remains ON.";
  if (_safety.inhibited) return "Cooling hold: heater OFF until temperature is at most 37.5 C.";
  if (_safety.low) return "Low temperature warning: check bulb, door and room temperature.";
  if(!_recoveryGuard.healthy) return "Recovery journal fault: turning held OFF; temperature control remains sensor protected.";
  if(!_recoveryReady || _checkpointFault || !_logger.isReady()) return "Temperature control active; SD recovery/logging fault holds automatic turning OFF. Check Component status for the SD error.";
  return "Temperature safety checks passed.";
}
String IncubatorController::turnState(uint8_t i) const {
  if(_manualMotor[i] && _turnCycles[i].active) return "Timed manual run";
  if(_queuedManual[i] && _queuedMotor[i]) return "Queued manual run";
  if (!_settings.autoMode) {
    if (_turnCycles[i].active) return "Timed manual run";
    if (_queuedMotor[i]) return "Queued manual run";
    if (manualMotorAllowed(i,millis())) return "Manual ready";
    if (_recoveryGuard.value.uncertainMask || _recoveryState.motors[i].positionHold) return "Recovering interrupted turn";
    if (!_safety.ready(millis())) return "Waiting for stable sensor readings";
    if (_profile.value.batchId[i][0] && (!_profile.value.active[i] || !_clock.isReady() ||
        !HatchTurning::ageAllowed(_clock.epoch(),_profile.value.start[i],_profile.value.reserved[i],_profile.value.turningEnd[i]))) return "Check batch status, clock or lockdown";
    return "Temperature, watchdog or internal storage hold";
  }
  if(!_recoveryReady) return "Recovery hold";
  if(_recoveryState.motors[i].positionHold) return "Skipping interrupted turn";
  if(_checkpointFault || !_logger.isReady()) return "SD checkpoint/logging hold";
  if (!_profile.healthy || !_watchdog.healthy || _safety.critical || _watchdog.recoveryRequired) return "Safety hold";
  if (!(_profile.value.flags & 2)) return "Disabled";
  if (!_clock.isReady()) return "Set clock / RTC unavailable";
  if (!_profile.value.start[i]) return "Choose a batch";
  if (!_profile.value.active[i]) return "Batch paused / completed";
  if (_clock.epoch() < _profile.value.reserved[i] || _clock.epoch() < _profile.value.start[i]) return "Check clock and batch date";
  if (_clock.epoch() >= (_profile.value.turningEnd[i] ? _profile.value.turningEnd[i] : _profile.value.start[i]+HatchConfig::LockdownAfterSeconds)) return "Lockdown: turning stopped";
  if (!_safety.ready(millis())) return "Sensor safety hold";
  if (_turnCycles[i].active) return "Turning";
  if (_queuedMotor[i] || _preparingMotor==i) return "Queued / verifying durable turn intent";
  return _settings.autoMode ? "Scheduled" : "Manual ready";
}
String IncubatorController::buildSafetyJson() const {
  String json = "{\"version\":2,\"message\":" + HatchJson::quote(safetyMessage());
  json += ",\"level\":" + HatchJson::quote(_safety.critical || !systemReady() ? "critical" :
    !_safety.ready(millis()) || _safety.inhibited || _safety.high || _safety.low || !_clock.isReady() ||
    _checkpointFault || !_logger.isReady() || _recoveryState.motors[0].positionHold || _recoveryState.motors[1].positionHold ? "warning" : "ok");
  json += ",\"critical\":" + HatchJson::boolValue(_safety.critical);
  json += ",\"resetAckRequired\":" + HatchJson::boolValue(_watchdog.recoveryRequired);
  json += ",\"sensorReady\":" + HatchJson::boolValue(_safety.ready(millis()));
  json += ",\"canAcknowledge\":" + HatchJson::boolValue(_profile.healthy && _recoveryGuard.healthy && _recoveryReady && _watchdog.healthy &&
    _safety.ready(millis()) && _safety.lastTemperature <= HatchConfig::HeaterResumeC);
  json += ",\"turningArmed\":" + HatchJson::boolValue((_profile.value.flags & 2) != 0);
  json += ",\"rtcTrusted\":" + HatchJson::boolValue(_clock.isReady());
  json += ",\"storageReady\":" + HatchJson::boolValue(_profile.healthy);
  json += ",\"watchdogReady\":" + HatchJson::boolValue(_watchdog.healthy);
  json += ",\"batches\":[";
  for (uint8_t i = 0; i < 2; ++i) {
    if (i) json += ',';
    json += "{\"motor\":" + String(i+1) + ",\"batchId\":" + HatchJson::quote(_profile.value.batchId[i]);
    json += ",\"startEpoch\":" + String(_profile.value.start[i]);
    HatchBatchTurns::Record counts;
    json += ",\"completedTurns\":";
    json += _batchTurnCounter.read(_profile.value.batchId[i],_profile.value.start[i],counts) ? String(counts.count[i]) : String("null");
    json += ",\"active\":" + HatchJson::boolValue(_profile.value.active[i]);
    const auto& batch=_recoveryState.batches[i]; const auto& transaction=_recoveryState.motors[i];
    json += ",\"durationDays\":"+String(batch.durationDays)+",\"batchStatus\":"+HatchJson::quote(HatchRecovery::batchText(batch.status));
    json += ",\"label\":"+HatchJson::quote(batch.label)+",\"name\":"+HatchJson::quote(batch.name)+",\"eggCount\":"+String(batch.eggCount);
    json += ",\"incubationDay\":"; json += _profile.healthy && _clock.isReady() && HatchRecovery::dayFromStart(_profile.value.start[i],_clock.epoch()) ? String(HatchRecovery::dayFromStart(_profile.value.start[i],_clock.epoch())) : String("null");
    json += ",\"expectedHatchEpoch\":"+String(batch.start?HatchRecovery::end(batch):0);
    json += ",\"turningEndEpoch\":"+String(batch.start?HatchRecovery::lockdown(batch):0);
    json += ",\"lockdownEpoch\":"+String(batch.start?HatchRecovery::lockdown(batch):0);
    json += ",\"nextTurnEpoch\":"+String(transaction.next)+",\"lastCompletedTurnEpoch\":"+String(transaction.completed);
    json += ",\"transaction\":"+HatchJson::quote(HatchRecovery::transactionText(transaction.transaction));
    json += ",\"cycleId\":"+String(transaction.cycle)+",\"lastSuccessfulCycleId\":"+String(transaction.lastSuccessfulCycle);
    json += ",\"positionHold\":"+HatchJson::boolValue(transaction.positionHold);
    json += ",\"status\":" + HatchJson::quote(turnState(i));
    json += ",\"canRun\":" + HatchJson::boolValue(_settings.autoMode ? motorAllowed(i, millis()) : manualMotorAllowed(i,millis()));
    json += ",\"canManualRun\":" + HatchJson::boolValue(manualMotorAllowed(i,millis()));
    json += ",\"nextTurnSeconds\":";
    json += motorAllowed(i, millis()) ? String(nextTurnInMs(millis(), i) / 1000) : String("null");
    json += '}';
  }
  return json + "]}";
}
