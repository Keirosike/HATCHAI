#include "DataLogger.h"
#include <SD.h>
#include <SPI.h>
#include "Config.h"

DataLogger::DataLogger(uint8_t csPin, const char* logPath)
  : _csPin(csPin), _logPath(logPath) {}

void DataLogger::begin() {
  SPI.begin(
    HatchConfig::SdCardSckPin,
    HatchConfig::SdCardMisoPin,
    HatchConfig::SdCardMosiPin,
    _csPin
  );

  _ready = SD.begin(_csPin);

  if (!_ready) {
    Serial.println("SD card not detected");
    return;
  }

  writeHeaderIfNeeded();
  Serial.println("SD card logger ready");
}

bool DataLogger::isReady() const {
  return _ready;
}

String DataLogger::statusText() const {
  return _ready ? "Ready" : "Not detected";
}

void DataLogger::logReading(
  const String& timestamp,
  const SensorReading& reading,
  const ControlSettings& settings,
  const EggTurningMetrics& turningMetrics,
  bool bulb1On,
  bool bulb2On,
  bool fanOn,
  bool turnerOn
) {
  if (!_ready || !reading.valid) {
    return;
  }

  File file = SD.open(_logPath, FILE_APPEND);

  if (!file) {
    _ready = false;
    Serial.println("Failed to open SD log file");
    return;
  }

  file.print(timestamp);
  file.print(",");
  file.print(reading.temperatureC, 1);
  file.print(",");
  file.print(reading.humidityPercent, 1);
  file.print(",");
  file.print(settings.autoMode ? "auto" : "manual");
  file.print(",");
  file.print(bulb1On ? "on" : "off");
  file.print(",");
  file.print(bulb2On ? "on" : "off");
  file.print(",");
  file.print(fanOn ? "on" : "off");
  file.print(",");
  file.print(turnerOn ? "on" : "off");
  file.print(",");
  file.print(settings.targetTemperatureC, 1);
  file.print(",");
  file.print(settings.targetHumidityPercent, 1);
  file.print(",");
  file.print(settings.turnIntervalMinutes);
  file.print(",");
  file.print(turningMetrics.totalTurns);
  file.print(",");
  file.print(turningMetrics.turnsToday);
  file.print(",");
  file.print(turningMetrics.lastTurnTimestamp);
  file.print(",");
  file.println(turningMetrics.actualTurnIntervalMinutes);
  file.close();
}

String DataLogger::csvHeader() const {
  return
    "timestamp,temperature_c,humidity_percent,mode,bulb1,bulb2,fan,turner,"
    "target_temperature_c,target_humidity_percent,turn_interval_minutes,"
    "total_turns,turns_today,last_turn_timestamp,actual_turn_interval_minutes";
}

void DataLogger::writeHeaderIfNeeded() {
  if (SD.exists(_logPath)) {
    File existingFile = SD.open(_logPath, FILE_READ);
    const String existingHeader = existingFile ? existingFile.readStringUntil('\n') : "";

    if (existingFile) {
      existingFile.close();
    }

    String normalizedHeader = existingHeader;
    normalizedHeader.trim();

    if (normalizedHeader == csvHeader()) {
      return;
    }

    const String backupPath = String(_logPath) + ".legacy-" + String(millis());

    if (!SD.rename(_logPath, backupPath.c_str())) {
      _ready = false;
      Serial.println("Failed to archive incompatible SD log");
      return;
    }

    Serial.print("Archived old SD log as ");
    Serial.println(backupPath);
  }

  File file = SD.open(_logPath, FILE_WRITE);

  if (!file) {
    _ready = false;
    return;
  }

  file.println(csvHeader());
  file.close();
}
