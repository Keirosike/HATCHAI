#include "DataLogger.h"
#include "Config.h"

DataLogger::DataLogger(uint8_t csPin,const char* logPath):_csPin(csPin),_logPath(logPath) {}
void DataLogger::begin() { _storage.begin(); }
bool DataLogger::isReady() const { const auto s=_storage.status(); return s.available && s.logging; }
String DataLogger::statusText() const {
  const auto s=_storage.status();
  if(!s.loaded) return "Initializing SD";
  if(s.error[0]) return String(s.error);
  if(s.available && !s.logging) return "SD logging fault; retry recovery";
  return s.available ? "Ready (queued logging)" : "Not detected";
}
void DataLogger::logReading(const String& timestamp,const SensorReading& reading,
  const ControlSettings& settings,const EggTurningMetrics& lower,const EggTurningMetrics& upper,
  bool bulb,bool fan,bool turner,bool turner2) {
  if(!reading.valid || timestamp.length()<19 || timestamp[4]!='-' || timestamp[7]!='-') return;
  const uint32_t now=millis();
  if(_logged && uint32_t(now-_lastLogMs)<HatchConfig::SensorLogIntervalMs) return;
  _logged=true; _lastLogMs=now;
  char line[512];
  const int size=snprintf(line,sizeof(line),"%s,%.1f,%.1f,%s,%s,%s,%s,%.1f,%.1f,%u,%lu,%u,%s,%u,%s,%u,%lu,%u,%s,%u\n",
    timestamp.c_str(),reading.temperatureC,reading.humidityPercent,settings.autoMode?"auto":"manual",
    bulb?"on":"off",fan?"on":"off",turner?"on":"off",settings.targetTemperatureC,settings.targetHumidityPercent,
    settings.turnIntervalMinutes,static_cast<unsigned long>(lower.totalTurns),lower.turnsToday,lower.lastTurnTimestamp.c_str(),
    lower.actualTurnIntervalMinutes,turner2?"on":"off",settings.turnInterval2Minutes,
    static_cast<unsigned long>(upper.totalTurns),upper.turnsToday,upper.lastTurnTimestamp.c_str(),upper.actualTurnIntervalMinutes);
  if(size>0 && size<int(sizeof(line))) _storage.log(RecoveryStorage::Legacy,line);
}
