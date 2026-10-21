#pragma once
#include <ArduinoJson.h>
#include "RecoveryState.h"

// Both formats use CRC over compact JSON with crc32 removed, preserving member order.
// This is corruption detection, not an authenticity/security signature.
class RecoveryCodec {
public:
  bool encode(const HatchRecovery::State& s, char* output, size_t capacity, size_t& length) {
    if(!HatchRecovery::valid(s)) return false;
    document.clear();
    document["formatVersion"]=2; document["sequence"]=s.sequence;
    document["rtc"]=s.rtc; document["startup"]=s.startup; document["restartReason"]=s.resetReason;
    document["flags"]=s.flags;
    JsonObject c=document.createNestedObject("config");
    c["temperatureMilliC"]=s.temperatureMilli; c["humidityMilliPercent"]=s.humidityMilli;
    c["offsetMilliC"]=s.offsetMilli; c["automatic"]=s.automatic; c["manualHeatRequested"]=s.manualHeatRequested;
    c["fanAlwaysOn"]=false; c["fanPolicy"]="auto_or_safety_override"; c["heaterControl"]="thermostat_hysteresis";
    c["hysteresisMilliC"]=int32_t(HatchConfig::HeaterHysteresisC*1000);
    c["windowMs"]=0; c["kp"]=0; c["ki"]=0; c["kd"]=0;
    c["derivativeFilterSeconds"]=0; c["rampPercentPerSecond"]=0;
    c["minimumRelayDwellMs"]=HatchConfig::HeaterRelayMinimumOffMs;
    c["inhibitMilliC"]=int32_t(HatchConfig::HeaterInhibitC*1000); c["resumeMilliC"]=int32_t(HatchConfig::HeaterResumeC*1000);
    c["highMilliC"]=int32_t(HatchConfig::HighTemperatureC*1000); c["criticalMilliC"]=int32_t(HatchConfig::CriticalTemperatureC*1000);
    c["lowMilliC"]=int32_t(HatchConfig::LowTemperatureC*1000); c["lowClearMilliC"]=int32_t(HatchConfig::LowClearC*1000);
    c["sensorStaleMs"]=HatchConfig::SensorStaleAfterMs; c["sensorIntervalMs"]=HatchConfig::SensorReadIntervalMs;
    c["lowWarmupMs"]=HatchConfig::LowWarningWarmupMs; c["lowDelayMs"]=HatchConfig::LowWarningDelayMs;
    c["fanPin"]=HatchConfig::FanRelayPin; c["heaterPin"]=HatchConfig::Bulb1RelayPin;
    c["lowerPin"]=HatchConfig::TurnerRelayPin; c["upperPin"]=HatchConfig::Turner2RelayPin; c["relayActiveHigh"]=HatchConfig::RelayActiveHigh;
    c["lockdownAfterSeconds"]=HatchConfig::LockdownAfterSeconds;
    c["sensorLogIntervalMs"]=HatchConfig::SensorLogIntervalMs;
    c["checkpointIntervalMs"]=HatchConfig::RecoveryCheckpointIntervalMs;
    c["pidAccumulatorRestored"]=false;
    JsonArray batches=document.createNestedArray("batches");
    for(uint8_t i=0;i<2;++i) {
      const auto& b=s.batches[i]; const auto& m=s.motors[i];
      JsonObject row=batches.createNestedObject(); row["id"]=b.id; row["start"]=b.start; row["turningEnd"]=b.turningEnd;
      row["label"]=b.label; row["name"]=b.name; row["eggCount"]=b.eggCount;
      row["durationDays"]=b.durationDays; row["status"]=uint8_t(b.status);
      row["incubationDay"]=HatchRecovery::day(b,s.rtc);
      row["expectedHatch"]=b.start ? HatchRecovery::end(b) : 0;
      row["lockdownStart"]=b.start ? HatchRecovery::lockdown(b) : 0;
      row["lockdown"]=b.start && s.rtc>=HatchRecovery::lockdown(b);
      row["complete"]=HatchRecovery::complete(b.status);
      row["intervalMinutes"]=s.interval[i]; row["runSeconds"]=s.duration[i];
      row["cycleId"]=m.cycle; row["issued"]=m.issued; row["lastCompleted"]=m.completed;
      row["nextScheduled"]=m.next; row["lastSuccessfulCycleId"]=m.lastSuccessfulCycle;
      row["transaction"]=uint8_t(m.transaction); row["positionHold"]=m.positionHold;
      row["physicalPositionVerified"]=false; // no position/rotation sensor is installed
    }
    JsonObject d=document.createNestedObject("diagnostics");
    d["sensorValid"]=s.sensorValid; d["temperatureMilliC"]=s.measuredTemperatureMilli;
    d["humidityMilliPercent"]=s.measuredHumidityMilli; d["highAlarm"]=s.highAlarm; d["lowAlarm"]=s.lowAlarm;
    d["pidOutputMilliPercent"]=s.pidOutputMilli; d["heaterOn"]=s.heaterOn;
    d["lowerOn"]=s.lowerOn; d["upperOn"]=s.upperOn;
    if(document.overflowed()) return false;
    CrcWriter crc; serializeJson(document,crc); document["crc32"]=crc.value();
    if(document.overflowed() || measureJson(document)>=capacity) return false;
    length=serializeJson(document,output,capacity); return length>0;
  }
  bool decode(const char* input, size_t length, HatchRecovery::State& state) {
    if(!length || length>HatchConfig::RecoveryMaxJsonBytes) return false;
    document.clear(); Reader reader{input,length,0};
    if(deserializeJson(document,reader,DeserializationOption::NestingLimit(8))) return false;
    while(reader.position<length) { const char c=input[reader.position++]; if(c!=' ' && c!='\n' && c!='\r' && c!='\t') return false; }
    uint32_t crc,version;
    if(!take(document["crc32"],crc) || !take(document["formatVersion"],version) || (version!=1 && version!=2)) return false;
    document.remove("crc32"); CrcWriter writer; serializeJson(document,writer); if(writer.value()!=crc) return false;
    HatchRecovery::State s={};
    if(!take(document["sequence"],s.sequence) || !take(document["rtc"],s.rtc) ||
       !take(document["startup"],s.startup) || !take(document["restartReason"],s.resetReason) ||
       !take(document["flags"],s.flags)) return false;
    JsonObjectConst c=document["config"];
    if(!take(c["temperatureMilliC"],s.temperatureMilli) || !take(c["humidityMilliPercent"],s.humidityMilli) ||
       !take(c["offsetMilliC"],s.offsetMilli) || !take(c["automatic"],s.automatic) ||
       !take(c["manualHeatRequested"],s.manualHeatRequested) || (version==1 ? c["fanAlwaysOn"]!=true :
         c["fanAlwaysOn"]!=false || c["fanPolicy"]!="auto_or_safety_override") ||
       !heaterConfigurationCompatible(c) ||
       c["inhibitMilliC"]!=int32_t(HatchConfig::HeaterInhibitC*1000) || c["resumeMilliC"]!=int32_t(HatchConfig::HeaterResumeC*1000) ||
       c["highMilliC"]!=int32_t(HatchConfig::HighTemperatureC*1000) || c["criticalMilliC"]!=int32_t(HatchConfig::CriticalTemperatureC*1000) ||
       c["lowMilliC"]!=int32_t(HatchConfig::LowTemperatureC*1000) || c["lowClearMilliC"]!=int32_t(HatchConfig::LowClearC*1000) ||
       !c["sensorStaleMs"].is<uint32_t>() || !c["sensorIntervalMs"].is<uint32_t>() ||
       !HatchRecovery::sensorTimingCompatible(c["sensorIntervalMs"].as<uint32_t>(),c["sensorStaleMs"].as<uint32_t>()) ||
       c["lowWarmupMs"]!=HatchConfig::LowWarningWarmupMs || c["lowDelayMs"]!=HatchConfig::LowWarningDelayMs ||
       c["fanPin"]!=HatchConfig::FanRelayPin || c["heaterPin"]!=HatchConfig::Bulb1RelayPin ||
       c["lowerPin"]!=HatchConfig::TurnerRelayPin || c["upperPin"]!=HatchConfig::Turner2RelayPin || c["relayActiveHigh"]!=HatchConfig::RelayActiveHigh ||
       c["lockdownAfterSeconds"]!=(version==1 ? 18UL*86400 : HatchConfig::LockdownAfterSeconds) ||
       c["sensorLogIntervalMs"]!=HatchConfig::SensorLogIntervalMs ||
       c["checkpointIntervalMs"]!=HatchConfig::RecoveryCheckpointIntervalMs || c["pidAccumulatorRestored"]!=false) return false;
    JsonArrayConst rows=document["batches"]; if(rows.size()!=2) return false;
    for(uint8_t i=0;i<2;++i) {
      auto& b=s.batches[i]; auto& m=s.motors[i]; JsonObjectConst row=rows[i];
      const char* id=row["id"].as<const char*>(); uint8_t status,transaction;
      const char* label=row["label"].as<const char*>(); const char* name=row["name"].as<const char*>();
      if(!id || strlen(id)>48 || row["id"].as<JsonString>().size()!=strlen(id) || !label || strlen(label)>30 ||
          row["label"].as<JsonString>().size()!=strlen(label) || !name || strlen(name)>64 ||
          row["name"].as<JsonString>().size()!=strlen(name) || !take(row["eggCount"],b.eggCount) ||
          !take(row["start"],b.start) || !take(row["durationDays"],b.durationDays) ||
          !take(row["status"],status) || !take(row["transaction"],transaction) ||
          !take(row["intervalMinutes"],s.interval[i]) || !take(row["runSeconds"],s.duration[i]) ||
          !take(row["cycleId"],m.cycle) || !take(row["issued"],m.issued) || !take(row["lastCompleted"],m.completed) ||
          !take(row["nextScheduled"],m.next) || !take(row["lastSuccessfulCycleId"],m.lastSuccessfulCycle) ||
          !take(row["positionHold"],m.positionHold)) return false;
      if(version>=2 && !take(row["turningEnd"],b.turningEnd)) return false;
      strcpy(b.id,id); strcpy(b.label,label); strcpy(b.name,name);
      b.status=HatchRecovery::BatchStatus(status); m.transaction=HatchRecovery::Transaction(transaction);
      const uint32_t savedCutoff=version==1 ? b.start+18UL*86400 : HatchRecovery::lockdown(b);
      if(row["incubationDay"]!=HatchRecovery::day(b,s.rtc) || row["expectedHatch"]!=(b.start?HatchRecovery::end(b):0) ||
          row["lockdownStart"]!=(b.start?savedCutoff:0) ||
          row["lockdown"]!=bool(b.start && s.rtc>=savedCutoff) ||
          row["complete"]!=HatchRecovery::complete(b.status) || row["physicalPositionVerified"]!=false) return false;
    }
    JsonObjectConst d=document["diagnostics"];
    if(!take(d["sensorValid"],s.sensorValid) || !take(d["temperatureMilliC"],s.measuredTemperatureMilli) ||
       !take(d["humidityMilliPercent"],s.measuredHumidityMilli) || !take(d["highAlarm"],s.highAlarm) ||
       !take(d["lowAlarm"],s.lowAlarm) || !take(d["pidOutputMilliPercent"],s.pidOutputMilli) ||
       !take(d["heaterOn"],s.heaterOn) || !take(d["lowerOn"],s.lowerOn) || !take(d["upperOn"],s.upperOn) ||
       !HatchRecovery::valid(s)) return false;
    state=s; return true;
  }
  // Human-readable configuration mirror; snapshots remain authoritative.
  size_t configuration(char* output,size_t capacity) { return serializeJson(document["config"],output,capacity); }
private:
  bool heaterConfigurationCompatible(JsonObjectConst c) const {
    if (c["minimumRelayDwellMs"]!=HatchConfig::HeaterRelayMinimumOffMs) return false;
    if (!c.containsKey("heaterControl")) {
      // Import known PID-era settings/batch journals; never replay old heat ON.
      return c["windowMs"]==HatchConfig::HeaterRelayWindowMs && c["kp"]==HatchConfig::HeaterPidKp &&
        c["ki"]==HatchConfig::HeaterPidKi && c["kd"]==HatchConfig::HeaterPidKd &&
        c["derivativeFilterSeconds"]==HatchConfig::HeaterPidDerivativeFilterSeconds &&
        c["rampPercentPerSecond"]==HatchConfig::HeaterPidRampPercentPerSecond;
    }
    return c["heaterControl"]=="thermostat_hysteresis" &&
      c["hysteresisMilliC"]==int32_t(HatchConfig::HeaterHysteresisC*1000) &&
      c["windowMs"]==0 && c["kp"]==0 && c["ki"]==0 && c["kd"]==0 &&
      c["derivativeFilterSeconds"]==0 && c["rampPercentPerSecond"]==0;
  }
  template<class T> bool take(JsonVariantConst v,T& out) { if(!v.is<T>()) return false; out=v.as<T>(); return true; }
  struct CrcWriter {
    uint32_t crc=0xFFFFFFFFUL;
    size_t write(uint8_t b) { crc=HatchRecovery::crcUpdate(crc,b); return 1; }
    size_t write(const uint8_t* data,size_t size) { for(size_t i=0;i<size;++i) write(data[i]); return size; }
    uint32_t value() const { return ~crc; }
  };
  struct Reader {
    const char* bytes; size_t length,position;
    int read() { return position<length ? uint8_t(bytes[position++]) : -1; }
    size_t readBytes(char* output,size_t count) { size_t n=0; while(n<count && position<length) output[n++]=bytes[position++]; return n; }
  };
  StaticJsonDocument<6144> document;
};
