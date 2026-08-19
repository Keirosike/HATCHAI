#include "IncubatorController.h"
#include "JsonBuilder.h"
#include <Preferences.h>
#include "hatchai_random_forest_esp32_final.h"

namespace {
Eloquent::ML::Port::RandomForestRegressor hatchModel;
const char* TurnMetricsNamespace = "hatchai-turn";
constexpr int ChickenIncubationDays = 21;
}

IncubatorController::IncubatorController(
  DhtSensor& sensor,
  OutputDevice& heater,
  OutputDevice& bulb2,
  OutputDevice& fan,
  OutputDevice& turner,
  RealTimeClock& clock,
  DataLogger& logger,
  LcdStatusDisplay& display
) : _sensor(sensor),
    _heater(heater),
    _bulb2(bulb2),
    _fan(fan),
    _turner(turner),
    _clock(clock),
    _logger(logger),
    _display(display) {}

void IncubatorController::begin() {
  _startedMs = millis();
  _clock.begin();
  loadTurnMetrics();
  _logger.begin();
  _display.begin();
  _sensor.begin();
  _heater.begin();
  _bulb2.begin();
  _fan.begin();
  _turner.begin();
}

void IncubatorController::update() {
  const uint32_t nowMs = millis();

  refreshTurnMetricsDate();
  readSensorIfDue(nowMs);
  updateOutputs(nowMs);
  refreshDisplayIfDue(nowMs);
}

void IncubatorController::setNetworkStatus(const String& status) {
  _networkStatus = status;
}

void IncubatorController::applySettings(const ControlSettings& settings) {
  _settings = settings;

  if (_settings.turnIntervalMinutes == 0) {
    _settings.turnIntervalMinutes = HatchConfig::DefaultTurnIntervalMinutes;
  }

  if (!_settings.autoMode) {
    _heater.set(_settings.heaterOn);
    _bulb2.set(_settings.bulb2On);
    _fan.set(_settings.fanOn);
    _turner.set(_settings.turnerOn);
  } else {
    _settings.bulb2On = _settings.heaterOn;
  }
}

void IncubatorController::triggerTurnCycle() {
  const uint32_t nowMs = millis();

  if (_turnerStopMs != 0) {
    return;
  }

  recordTurnEvent(nowMs);
  _turner.set(true);
  _turnerStopMs = nowMs + HatchConfig::TurnerPulseMs;
}

ControlSettings IncubatorController::settings() const {
  ControlSettings current = _settings;
  current.heaterOn = _heater.isOn();
  current.bulb2On = _bulb2.isOn();
  current.fanOn = _fan.isOn();
  current.turnerOn = _turner.isOn();

  return current;
}

String IncubatorController::buildStatusJson(
  const String& wifiStatus,
  const String& ipAddress
) const {
  const bool valid = _currentReading.valid;
  const bool heatingOn = _heater.isOn() || _bulb2.isOn();
  const uint32_t nowMs = millis();
  const uint32_t nextTurnMs = nextTurnInMs(nowMs);
  const int hatchDay = predictedHatchDay();
  const int daysRemaining = predictedDaysRemaining();
  const String predictedDate = predictedHatchDateIso();

  String json = "{";
  json += "\"temperature\":";
  json += HatchJson::number(_currentReading.temperatureC, 1);
  json += ",";
  json += "\"humidity\":";
  json += HatchJson::number(_currentReading.humidityPercent, 0);
  json += ",";
  json += "\"relayStatus\":";
  json += HatchJson::quote(heatingOn ? "Heating ON" : "Heating OFF");
  json += ",";
  json += "\"relayBadge\":";
  json += HatchJson::quote(heatingOn ? "Bulbs Active" : "Bulbs Idle");
  json += ",";
  json += "\"relayOn\":";
  json += HatchJson::boolValue(heatingOn);
  json += ",";
  json += "\"motorStatus\":";
  json += HatchJson::quote(_turner.isOn() ? "Turning" : "Idle");
  json += ",";
  json += "\"motorNote\":";

  if (_turner.isOn()) {
    json += HatchJson::quote("Egg turn cycle is running");
  } else if (_settings.autoMode) {
    json += HatchJson::quote(String("Next egg turning in ") + formatDuration(nextTurnMs));
  } else {
    json += HatchJson::quote("Manual control mode");
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
  json += HatchJson::quote(_clock.statusText());
  json += ",";
  json += "\"rtcTime\":";
  json += HatchJson::quote(_clock.timestamp());
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
  json += HatchJson::quote(_settings.autoMode ? "Enabled" : "Manual");
  json += ",";
  json += "\"lastTurn\":";
  json += HatchJson::quote(_turningMetrics.lastTurnTimestamp);
  json += ",";
  json += "\"totalTurns\":";
  json += String(_turningMetrics.totalTurns);
  json += ",";
  json += "\"turnsToday\":";
  json += String(_turningMetrics.turnsToday);
  json += ",";
  json += "\"actualTurnIntervalMinutes\":";
  json += String(_turningMetrics.actualTurnIntervalMinutes);
  json += ",";
  json += "\"lastAnomaly\":";
  json += HatchJson::quote(_lastAnomaly);
  json += ",";
  json += "\"sensorStatus\":";
  json += HatchJson::quote(valid ? "Connected" : "No reading");
  json += ",";
  json += "\"wifiStatus\":";
  json += HatchJson::quote(wifiStatus);
  json += ",";
  json += "\"ipAddress\":";
  json += HatchJson::quote(ipAddress);
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
  json += HatchJson::boolValue(_bulb2.isOn());
  json += ",";
  json += "\"fanOn\":";
  json += HatchJson::boolValue(_fan.isOn());
  json += ",";
  json += "\"turnerOn\":";
  json += HatchJson::boolValue(_turner.isOn());
  json += ",";
  json += "\"targetTemperature\":";
  json += HatchJson::number(_settings.targetTemperatureC, 1);
  json += ",";
  json += "\"targetHumidity\":";
  json += HatchJson::number(_settings.targetHumidityPercent, 0);
  json += ",";
  json += "\"turnIntervalMinutes\":";
  json += String(_settings.turnIntervalMinutes);
  json += "}}";

  return json;
}

String IncubatorController::buildPredictionJson(
  const String& batchId,
  int incubationDay
) const {
  String json = "{";
  json += "\"success\":";

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
  if (
    _hasReadSensor &&
    !hasElapsed(nowMs, _lastSensorReadMs, HatchConfig::SensorReadIntervalMs)
  ) {
    return;
  }

  _lastSensorReadMs = nowMs;
  _hasReadSensor = true;

  const SensorReading reading = _sensor.read();
  _lastReadingTimestamp = _clock.isReady() ? _clock.timestamp() : formatUptime(reading.timestampMs);

  if (reading.valid) {
    _currentReading = reading;
    _history.add(reading);
    _logger.logReading(
      _lastReadingTimestamp,
      reading,
      _settings,
      _turningMetrics,
      _heater.isOn(),
      _bulb2.isOn(),
      _fan.isOn(),
      _turner.isOn()
    );
    _lastAnomaly = "None";
    return;
  }

  if (
    _currentReading.valid &&
    nowMs - _currentReading.timestampMs <= HatchConfig::SensorStaleAfterMs
  ) {
    _lastAnomaly = reading.error;
    return;
  }

  _currentReading = reading;
  _lastAnomaly = reading.error;
}

void IncubatorController::updateOutputs(uint32_t nowMs) {
  updateTurnerPulse(nowMs);

  if (_settings.autoMode) {
    updateAutomaticOutputs();
    maybeStartScheduledTurn(nowMs);
  }
}

void IncubatorController::updateAutomaticOutputs() {
  if (!_currentReading.valid) {
    _heater.set(false);
    _bulb2.set(false);
    _fan.set(false);
    return;
  }

  const float temp = _currentReading.temperatureC;
  const float humidity = _currentReading.humidityPercent;
  const float targetTemp = _settings.targetTemperatureC;
  const float targetHumidity = _settings.targetHumidityPercent;

  if (temp < targetTemp - 0.3f) {
    _heater.set(true);
    _bulb2.set(true);
  } else if (temp > targetTemp + 0.3f) {
    _heater.set(false);
    _bulb2.set(false);
  }

  _fan.set(temp > targetTemp + 0.5f || humidity > targetHumidity + 5.0f);
}

void IncubatorController::updateTurnerPulse(uint32_t nowMs) {
  if (_turnerStopMs == 0) {
    return;
  }

  if (static_cast<int32_t>(nowMs - _turnerStopMs) < 0) {
    return;
  }

  _turnerStopMs = 0;
  _turner.set(_settings.autoMode ? false : _settings.turnerOn);
}

void IncubatorController::maybeStartScheduledTurn(uint32_t nowMs) {
  if (_turnerStopMs != 0) {
    return;
  }

  const uint32_t intervalMs =
    static_cast<uint32_t>(_settings.turnIntervalMinutes) * 60000UL;
  const uint32_t baseMs = _hasTurned ? _lastTurnMs : _startedMs;

  if (hasElapsed(nowMs, baseMs, intervalMs)) {
    triggerTurnCycle();
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
  _display.showStatus(
    _currentReading,
    _turner.isOn(),
    predictedHatchDateText()
  );
}

void IncubatorController::loadTurnMetrics() {
  Preferences preferences;
  preferences.begin(TurnMetricsNamespace, true);
  _turningMetrics.totalTurns = preferences.getULong("total", 0);
  _turningMetrics.turnsToday = preferences.getUShort("today", 0);
  _turningMetrics.actualTurnIntervalMinutes = preferences.getUShort("interval", 0);
  _turningMetrics.lastTurnTimestamp = preferences.getString("last", "None");
  _turnMetricsDateKey = preferences.getString("date", "");
  preferences.end();

  refreshTurnMetricsDate();
}

void IncubatorController::persistTurnMetrics() const {
  Preferences preferences;
  preferences.begin(TurnMetricsNamespace, false);
  preferences.putULong("total", _turningMetrics.totalTurns);
  preferences.putUShort("today", _turningMetrics.turnsToday);
  preferences.putUShort("interval", _turningMetrics.actualTurnIntervalMinutes);
  preferences.putString("last", _turningMetrics.lastTurnTimestamp);
  preferences.putString("date", _turnMetricsDateKey);
  preferences.end();
}

void IncubatorController::refreshTurnMetricsDate() {
  const String currentDateKey = turnDateKey();

  if (_turnMetricsDateKey != currentDateKey) {
    _turnMetricsDateKey = currentDateKey;
    _turningMetrics.turnsToday = 0;
    persistTurnMetrics();
  }
}

void IncubatorController::recordTurnEvent(uint32_t nowMs) {
  refreshTurnMetricsDate();

  if (_hasTurned) {
    _turningMetrics.actualTurnIntervalMinutes =
      static_cast<uint16_t>((nowMs - _lastTurnMs + 30000UL) / 60000UL);
  }

  _lastTurnMs = nowMs;
  _hasTurned = true;
  _turningMetrics.totalTurns++;
  _turningMetrics.turnsToday++;
  _turningMetrics.lastTurnTimestamp =
    _clock.isReady() ? _clock.timestamp() : formatUptime(nowMs);
  persistTurnMetrics();
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
  return static_cast<int>((millis() - _startedMs) / 86400000UL);
}

int IncubatorController::predictedHatchDay() const {
  const int daysRemaining = predictedDaysRemaining();
  return daysRemaining > 0 ? incubationDay() + daysRemaining : 0;
}

int IncubatorController::predictedDaysRemaining() const {
  return predictedDaysRemainingForDay(incubationDay());
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

uint32_t IncubatorController::nextTurnInMs(uint32_t nowMs) const {
  const uint32_t intervalMs =
    static_cast<uint32_t>(_settings.turnIntervalMinutes) * 60000UL;
  const uint32_t baseMs = _hasTurned ? _lastTurnMs : _startedMs;
  const uint32_t elapsedMs = nowMs - baseMs;

  if (elapsedMs >= intervalMs) {
    return 0;
  }

  return intervalMs - elapsedMs;
}
