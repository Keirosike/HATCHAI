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
#include "TurnCycle.h"
#include "RelayThermostat.h"
#include "ThermalSafety.h"
#include "DeviceProfile.h"
#include "RuntimeWatchdog.h"
#include "TurnSchedule.h"
#include "RecoveryGuard.h"

class IncubatorController {
public:
  IncubatorController(
    Dht22Sensor& sensor,
    OutputDevice& heater,
    OutputDevice& fan,
    OutputDevice& turner,
    OutputDevice& turner2,
    RealTimeClock& clock,
    DataLogger& logger,
    LcdStatusDisplay& display
  );

  void begin();
  void initializeOutputs();
  void update();
  void setNetworkStatus(const String& status);
  bool applySettings(const ControlSettings& settings);
  bool triggerTurnCycle(uint8_t motor = 0, uint32_t pulseMs = HatchConfig::TurnerPulseMs, bool manual = false);
  void stopTurnCycle(uint8_t motor = 0); // 0 = both, 1 = IN3, 2 = IN4
  void completeLoop();
  bool acknowledgeAlarm();
  bool setTurningArmed(bool armed);
  bool setClock(const String& iso);
  bool autoSyncClock(const String& iso);
  bool bindBatch(uint8_t motor, const String& id, const String& startDate, bool active,
    const String& startTime = "00:00:00", uint16_t durationDays = HatchConfig::DefaultIncubationDays,
    const String& status = "", const String& turningEnd = "");
  bool updateBoundBatch(const String& id, const String& date, bool active,
    const String& startTime = "00:00:00", uint16_t durationDays = HatchConfig::DefaultIncubationDays,
    const String& status = "", uint8_t roller = 0, const String& turningEnd = "");
  bool retryRecovery();
  bool initializeRecovery(bool automatic = false);
  bool acknowledgePosition(uint8_t motor);
  bool updateBatchMetadata(const String& id,const String& label,const String& name,uint16_t eggs);

  ControlSettings settings() const;
  String buildStatusJson(const String& wifiStatus, const String& ipAddress) const;
  String buildPredictionJson(const String& batchId, int incubationDay) const;

private:
  bool hasElapsed(uint32_t nowMs, uint32_t previousMs, uint32_t intervalMs) const;
  void readSensorIfDue(uint32_t nowMs);
  void updateOutputs(uint32_t nowMs);
  void updateAutomaticOutputs(uint32_t nowMs);
  void updateTurnerPulse(uint32_t nowMs);
  void maybeStartScheduledTurn(uint32_t nowMs);
  void refreshDisplayIfDue(uint32_t nowMs);
  void loadTurnMetrics(uint8_t index);
  void persistTurnMetrics(uint8_t index) const;
  void refreshTurnMetricsDate(uint8_t index);
  void recordTurnEvent(uint32_t nowMs, uint8_t index);
  void forceHeaterOff(uint32_t nowMs);
  bool persistProfile();
  bool systemReady() const;
  bool motorAllowed(uint8_t index, uint32_t nowMs) const;
  bool manualMotorAllowed(uint8_t index, uint32_t nowMs) const;
  bool startManualMotor(uint8_t index, uint32_t pulseMs);
  void finishManualMotor(uint8_t index);
  bool startMotor(uint8_t index, uint32_t pulseMs);
  String safetyMessage() const;
  String turnState(uint8_t index) const;
  String buildSafetyJson() const;
  String buildRecoveryJson() const;
  void updateRecovery(uint32_t nowMs);
  void restoreSnapshot(const HatchRecovery::State& state);
  HatchRecovery::State snapshot() const;
  enum class CommitPurpose : uint8_t { Normal, Startup, Initialize, Pending, Start, Finish, Position };
  bool requestCheckpoint(CommitPurpose purpose, bool initialize = false);
  void checkpointFailed(const char* message);
  void finishMotor(uint8_t motor);
  void logSystem(const char* event, const String& detail);
  void logMotor(uint8_t index,const char* reason);
  void requestStateSave();
  OutputDevice& motorOutput(uint8_t index) const;
  uint16_t motorInterval(uint8_t index) const;
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
  uint32_t nextTurnInMs(uint32_t nowMs, uint8_t index) const;

  Dht22Sensor& _sensor;
  OutputDevice& _heater;
  OutputDevice& _fan;
  OutputDevice& _turner;
  OutputDevice& _turner2;
  RealTimeClock& _clock;
  DataLogger& _logger;
  LcdStatusDisplay& _display;
  ReadingHistory _history;
  ControlSettings _settings;
  RelayThermostat _heaterControl;
  ThermalSafety _safety;
  DeviceProfileStore _profile;
  RuntimeWatchdog _watchdog;
  RecoveryGuard _recoveryGuard;
  HatchRecovery::State _recoveryState;
  RecoveryStorage::Pair _recoveryPair;
  bool _recoveryLoaded=false, _recoveryReady=false, _checkpointDirty=false;
  bool _checkpointFault=false;
  bool _batchEditInProgress=false;
  uint32_t _lastAutoRecoveryMs=0;
  uint32_t _recoveryLoadStartedMs=0;
  bool _seenLockdown[2]={false,false};
  bool _finishAwaiting[2]={false,false};
  uint32_t _checkpointTicket=0,_checkpointRequestedMs=0,_lastCheckpointMs=0;
  uint32_t _startupEpoch=0,_resumeTurnsAfter=0,_lastDiagnosticLogMs=0;
  uint32_t _lastStorageErrors=0,_lastDroppedLogs=0;
  uint32_t _sequenceCursor=0;
  bool _sequenceReserved=false;
  bool _clockReviewed=false;
  bool _outputsInitialized=false;
  int8_t _activeSnapshot=-1,_preparingMotor=-1,_commitMotor=-1;
  uint32_t _preparingPulseMs=0;
  CommitPurpose _commitPurpose=CommitPurpose::Normal;
  String _recoveryMessage="Loading SD recovery snapshots";
  bool _queuedMotor[2] = {false, false};
  bool _manualMotor[2] = {false, false};
  bool _queuedManual[2] = {false, false};
  uint32_t _queuedPulseMs[2] = {0, 0};
  uint32_t _motorOffMs = 0;
  uint8_t _preferredMotor = 0;
  EggTurningMetrics _turningMetrics[2];
  TurnCycle _turnCycles[2];
  SensorReading _currentReading;
  bool _hasReadSensor = false;
  uint32_t _startedMs = 0;
  uint32_t _lastSensorReadMs = 0;
  uint32_t _lastDisplayRefreshMs = 0;
  String _networkStatus = "Offline";
  String _turnMetricsDateKey[2];
  String _lastReadingTimestamp = "Not set";
  String _lastAnomaly = "None";
};
