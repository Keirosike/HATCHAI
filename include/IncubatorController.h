#pragma once

#include <Arduino.h>
#include "Config.h"
#include "DataLogger.h"
#include "IncubatorTypes.h"
#include "LcdStatusDisplay.h"
#include "OutputDevice.h"
#include "ReadingHistory.h"
#include "RealTimeClock.h"
#include "Dht22Sensor.h"

class IncubatorController {
public:
  IncubatorController(
    Dht22Sensor& sensor,
    OutputDevice& heater,
    OutputDevice& bulb2,
    OutputDevice& fan,
    OutputDevice& turner,
    RealTimeClock& clock,
    DataLogger& logger,
    LcdStatusDisplay& display
  );

  void begin();
  void update();
  void setNetworkStatus(const String& status);
  void applySettings(const ControlSettings& settings);
  void triggerTurnCycle();

  ControlSettings settings() const;
  String buildStatusJson(const String& wifiStatus, const String& ipAddress) const;
  String buildPredictionJson(const String& batchId, int incubationDay) const;

private:
  bool hasElapsed(uint32_t nowMs, uint32_t previousMs, uint32_t intervalMs) const;
  void readSensorIfDue(uint32_t nowMs);
  void updateOutputs(uint32_t nowMs);
  void updateAutomaticOutputs();
  void updateTurnerPulse(uint32_t nowMs);
  void maybeStartScheduledTurn(uint32_t nowMs);
  void refreshDisplayIfDue(uint32_t nowMs);
  void loadTurnMetrics();
  void persistTurnMetrics() const;
  void refreshTurnMetricsDate();
  void recordTurnEvent(uint32_t nowMs);
  String turnDateKey() const;

  int incubationDay() const;
  int predictedHatchDay() const;
  int predictedDaysRemaining() const;
  int predictedDaysRemainingForDay(int batchIncubationDay) const;
  String predictedHatchDateText() const;
  String predictedHatchDateIso() const;
  bool hasPredictionSensorReading() const;
  bool isValidIncubationDay(int batchIncubationDay) const;
  int clampIncubationDay(int batchIncubationDay) const;
  String dateIso(const DateTimeValue& date) const;
  DateTimeValue addDays(const DateTimeValue& date, int days) const;
  uint8_t daysInMonth(uint16_t year, uint8_t month) const;
  String temperatureSummary() const;
  String humiditySummary() const;
  String formatDuration(uint32_t durationMs) const;
  String formatUptime(uint32_t timestampMs) const;
  uint32_t nextTurnInMs(uint32_t nowMs) const;

  Dht22Sensor& _sensor;
  OutputDevice& _heater;
  OutputDevice& _bulb2;
  OutputDevice& _fan;
  OutputDevice& _turner;
  RealTimeClock& _clock;
  DataLogger& _logger;
  LcdStatusDisplay& _display;
  ReadingHistory _history;
  ControlSettings _settings;
  EggTurningMetrics _turningMetrics;
  SensorReading _currentReading;
  bool _hasReadSensor = false;
  bool _hasTurned = false;
  uint32_t _startedMs = 0;
  uint32_t _lastSensorReadMs = 0;
  uint32_t _lastDisplayRefreshMs = 0;
  uint32_t _lastTurnMs = 0;
  uint32_t _turnerStopMs = 0;
  String _networkStatus = "Offline";
  String _turnMetricsDateKey;
  String _lastReadingTimestamp = "Not set";
  String _lastAnomaly = "None";
};
