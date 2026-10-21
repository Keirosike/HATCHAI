#include "IncubatorController.h"
#include "JsonBuilder.h"
#include <limits.h>

using namespace HatchRecovery;

State IncubatorController::snapshot() const {
  State s=_recoveryState;
  s.rtc=_clock.epoch(); s.startup=_startupEpoch ? _startupEpoch : s.rtc;
  s.resetReason=uint32_t(_watchdog.reason); s.flags=_profile.value.flags&7;
  s.automatic=_settings.autoMode; s.manualHeatRequested=_settings.heaterOn;
  s.temperatureMilli=lroundf(_settings.targetTemperatureC*1000); s.humidityMilli=lroundf(_settings.targetHumidityPercent*1000);
  s.offsetMilli=lroundf(_settings.temperatureOffsetC*1000);
  s.interval[0]=_settings.turnIntervalMinutes; s.interval[1]=_settings.turnInterval2Minutes;
  s.duration[0]=_settings.turnDurationSeconds; s.duration[1]=_settings.turnDuration2Seconds;
  s.sensorValid=_currentReading.valid; s.highAlarm=_safety.high; s.lowAlarm=_safety.low;
  s.measuredTemperatureMilli=s.sensorValid ? lroundf(_currentReading.temperatureC*1000) : 0;
  s.measuredHumidityMilli=s.sensorValid ? lroundf(_currentReading.humidityPercent*1000) : 0;
  s.pidOutputMilli=0; // Legacy snapshot diagnostic; PID is no longer used.
  s.heaterOn=_heater.isOn(); s.lowerOn=_turner.isOn(); s.upperOn=_turner2.isOn();
  return s;
}
void IncubatorController::logSystem(const char* event,const String& detail) {
  String safe=detail; safe.replace(",",";"); safe.replace("\n"," "); safe.replace("\r"," ");
  char line[512]; snprintf(line,sizeof(line),"%lu,%s,%.360s\n",static_cast<unsigned long>(_clock.epoch()),event,safe.c_str());
  _logger.storage().log(RecoveryStorage::Events,line);
}
void IncubatorController::logMotor(uint8_t i,const char* reason) {
  const Motor& m=_recoveryState.motors[i]; char line[240];
  snprintf(line,sizeof(line),"%lu,%u,%lu,%s,%lu,%lu,false,%s\n",static_cast<unsigned long>(_clock.epoch()),i+1,
    static_cast<unsigned long>(m.cycle),transactionText(m.transaction),
    static_cast<unsigned long>(_preparingMotor==i ? _preparingPulseMs/1000 : _turnCycles[i].pulseDurationMs/1000),
    static_cast<unsigned long>(m.next),reason);
  _logger.storage().log(RecoveryStorage::Turning,line);
}
void IncubatorController::requestStateSave() { _checkpointDirty=true; }
bool IncubatorController::requestCheckpoint(CommitPurpose purpose,bool initialize) {
  if(_checkpointTicket || !_clock.isReady() || !_logger.storage().status().available) return false;
  if(!_sequenceReserved) {
    _sequenceCursor=_recoveryGuard.value.sequenceCeiling;
    for(uint8_t i=0;i<2;++i) if(_recoveryPair.valid[i]) _sequenceCursor=max(_sequenceCursor,_recoveryPair.state[i].sequence);
  }
  if(!_sequenceReserved || _sequenceCursor>=_recoveryGuard.value.sequenceCeiling) {
    if(_sequenceCursor>UINT32_MAX-256) return false;
    _recoveryGuard.value.sequenceCeiling=_sequenceCursor+256;
    if(!_recoveryGuard.save()) return false;
    _sequenceReserved=true;
  }
  State state=snapshot(); state.sequence=++_sequenceCursor;
  const uint32_t ticket=_logger.storage().checkpoint(state,_activeSnapshot,initialize);
  if(!ticket) return false;
  _checkpointTicket=ticket; _checkpointRequestedMs=millis(); _commitPurpose=purpose;
  _commitMotor=_preparingMotor; _checkpointDirty=false; return true;
}
void IncubatorController::checkpointFailed(const char* message) {
  _checkpointFault=true; _recoveryMessage=message; _checkpointTicket=0;
  stopTurnCycle(); logSystem("RECOVERY_FAULT",message);
  for(uint8_t i=0;i<2;++i) if(_recoveryGuard.value.uncertainMask&(1<<i)) _recoveryState.motors[i].positionHold=true;
  // A runtime SD fault stops motion. An already recovered, healthy NVS/sensor
  // control state may keep regulating temperature; boot faults never heat.
}
void IncubatorController::restoreSnapshot(const State& s) {
  stopTurnCycle(); forceHeaterOff(millis());
  const uint32_t persistedFlags=_profile.value.flags;
  const auto latest=_profile.value;
  _recoveryState=s; _startupEpoch=_clock.epoch();
  _settings.targetTemperatureC=s.temperatureMilli/1000.0f; _settings.targetHumidityPercent=s.humidityMilli/1000.0f;
  _settings.temperatureOffsetC=s.offsetMilli/1000.0f;
  _settings.autoMode=_profile.existed && (latest.flags&16) ? !(latest.flags&8) : s.automatic;
  _settings.heaterOn=false; _settings.turnerOn=_settings.turner2On=false; _settings.fanOn=true;
  _settings.turnIntervalMinutes=s.interval[0]; _settings.turnInterval2Minutes=s.interval[1];
  _settings.turnDurationSeconds=s.duration[0]; _settings.turnDuration2Seconds=s.duration[1];
  DeviceProfile& p=_profile.value;
  if(_profile.existed) {
    _settings.targetTemperatureC=latest.temperature; _settings.targetHumidityPercent=latest.humidity;
    _settings.temperatureOffsetC=latest.calibration;
    _settings.turnIntervalMinutes=latest.interval[0]; _settings.turnInterval2Minutes=latest.interval[1];
    _settings.turnDurationSeconds=latest.duration[0]; _settings.turnDuration2Seconds=latest.duration[1];
  }
  p.temperature=_settings.targetTemperatureC; p.humidity=_settings.targetHumidityPercent; p.calibration=_settings.temperatureOffsetC;
  // Safety latches are a union; an older SD copy cannot clear a newer NVS alarm.
  p.flags=((s.flags | persistedFlags)&5) | (_settings.autoMode ? 0 : 8) | 16;
  if(!_profile.existed || !_recoveryGuard.existed) p.flags|=4; // flash journal was recreated: explicit safety review
  if(_profile.existed ? (persistedFlags&2) : (s.flags&2)) p.flags|=2;
  _safety.critical=(p.flags&1)!=0;
  _watchdog.recoveryRequired=(p.flags&4)!=0 || (_watchdog.recoveryRequired && _watchdog.reason!=ESP_RST_BROWNOUT);
  if(_watchdog.recoveryRequired) p.flags|=4;
  for(uint8_t i=0;i<2;++i) {
    Batch& b=_recoveryState.batches[i]; Motor& m=_recoveryState.motors[i];
    _finishAwaiting[i]=false;
    if(_profile.existed && (strcmp(b.id,latest.batchId[i]) || b.start!=latest.start[i])) {
      // NVS is the last durable user assignment if power failed before SD ack.
      // Keep the old SD slot protected until this reconciled startup is verified.
      Batch recovered;
      for(uint8_t j=0;j<2;++j) if(latest.batchId[i][0] && strcmp(s.batches[j].id,latest.batchId[i])==0 &&
          s.batches[j].start==latest.start[i]) recovered=s.batches[j];
      strcpy(recovered.id,latest.batchId[i]); recovered.start=latest.start[i];
      recovered.status=!recovered.id[0] ? BatchStatus::Empty : latest.active[i] ? BatchStatus::Active :
        _recoveryGuard.value.batchStatus[i]>=2 ? BatchStatus(_recoveryGuard.value.batchStatus[i]) : BatchStatus::Paused;
      b=recovered; m=Motor();
      if(b.start) {m.cycle=_recoveryGuard.value.serial[i];m.next=_clock.epoch()+uint32_t(latest.interval[i])*60;}
      logSystem("NVS_ASSIGNMENT_RECOVERED",String(i+1));
    }
    if(_profile.existed) {b.turningEnd=latest.turningEnd[i];b.durationDays=_recoveryGuard.value.periodDays[i];}
    p.turningEnd[i]=b.turningEnd;
    if(_profile.existed && b.id[0]) {
      const uint8_t phase=_recoveryGuard.value.batchStatus[i];
      b.status=latest.active[i] ? BatchStatus::Active : phase>=uint8_t(BatchStatus::Paused) ? BatchStatus(phase) : BatchStatus::Paused;
    }
    _recoveryGuard.value.serial[i]=max(_recoveryGuard.value.serial[i],m.cycle);
    _recoveryGuard.value.periodDays[i]=b.durationDays; _recoveryGuard.value.batchStatus[i]=uint8_t(b.status);
    strcpy(p.batchId[i],b.id); p.start[i]=b.start; p.active[i]=b.status==BatchStatus::Active;
    p.duration[i]=_profile.existed ? latest.duration[i] : s.duration[i];
    p.interval[i]=_profile.existed ? latest.interval[i] : s.interval[i];
    p.reserved[i]=b.start ? (m.issued ? m.issued : b.start) : 0;
    if(positionCheck(m,_recoveryGuard.value.serial[i],_recoveryGuard.value.uncertainMask&(1<<i),b.id[0]) ||
        (b.id[0] && (!_profile.existed || !_recoveryGuard.existed))) {
      m.positionHold=true; _recoveryGuard.value.uncertainMask|=1<<i;
      if(b.id[0]) { m.transaction=Transaction::Interrupted; m.cycle=max(m.cycle,_recoveryGuard.value.serial[i]); }
      logMotor(i,"restart_position_unknown");
    }
    if(b.start) m.next=reconciledNext(_clock.epoch(),m.next);
    _seenLockdown[i]=b.start && s.rtc>=lockdown(b);
  }
  _resumeTurnsAfter=_clock.epoch()+HatchConfig::RecoveryResumeTurnDelaySeconds;
  _safety.invalidate(); _currentReading.valid=false;
  persistProfile(); _recoveryGuard.save();
}
bool IncubatorController::retryRecovery() {
  if(_checkpointTicket || _turnCycles[0].active || _turnCycles[1].active || _preparingMotor>=0) return false;
  if(!_logger.storage().reload()) return false;
  // A missing card must not create a periodic OFF/ON heat pulse. Successful
  // snapshot restoration requalifies heat separately from this asynchronous retry.
  stopTurnCycle(); _recoveryReady=false; _recoveryLoaded=false;
  _checkpointFault=false; _sequenceReserved=false; _checkpointDirty=false;
  _recoveryMessage="Reloading recovery files"; _recoveryLoadStartedMs=millis(); return true;
}
bool IncubatorController::initializeRecovery(bool automatic) {
  if(_recoveryReady || _checkpointTicket || !_profile.healthy || !_recoveryGuard.healthy || !_clock.isReady() ||
      !_safety.ready(millis()) || _clock.epoch()<_recoveryGuard.value.lastRtc || !_logger.storage().status().available) return false;
  stopTurnCycle(); forceHeaterOff(millis());
  _startupEpoch=_clock.epoch(); _recoveryState=State();
  for(uint8_t i=0;i<2;++i) {
    Batch& b=_recoveryState.batches[i]; Motor& m=_recoveryState.motors[i];
    strcpy(b.id,_profile.value.batchId[i]); b.start=_profile.value.start[i];
    b.durationDays=_recoveryGuard.value.periodDays[i]; b.turningEnd=_profile.value.turningEnd[i];
    if(b.id[0]) {
      if(!HatchCalendar::validEpoch(b.start) || b.start>_clock.epoch()) return false;
      b.status=_profile.value.active[i] ? BatchStatus::Active : _recoveryGuard.value.batchStatus[i]>=2 ?
        BatchStatus(_recoveryGuard.value.batchStatus[i]) : BatchStatus::Paused;
      m.next=_clock.epoch()+uint32_t(_profile.value.interval[i])*60;
      m.cycle=_recoveryGuard.value.serial[i];
      m.positionHold=!automatic || (_recoveryGuard.value.uncertainMask&(1<<i));
      if(m.positionHold) _recoveryGuard.value.uncertainMask|=1<<i;
    }
  }
  if(!automatic) _profile.value.flags&=~2UL;
  if(!persistProfile() || !_recoveryGuard.save()) return false;
  _checkpointFault=false; _recoveryLoaded=true;
  _recoveryMessage="Saving reviewed device settings and original batch dates";
  return requestCheckpoint(CommitPurpose::Initialize,_activeSnapshot<0);
}
bool IncubatorController::acknowledgePosition(uint8_t motor) {
  if(motor>=1 && motor<=2 && !_turnCycles[0].active && !_turnCycles[1].active && _preparingMotor<0 &&
      (_profile.value.flags&2) && _profile.healthy) {
    _profile.value.flags&=~2UL; if(!persistProfile()) return false;
  }
  if (motor>=1 && motor<=2 && !_settings.autoMode && !_turnCycles[0].active && !_turnCycles[1].active &&
      _preparingMotor<0 && systemReady() && _safety.ready(millis()) && !_safety.critical && _recoveryGuard.healthy) {
    const uint8_t i=motor-1;
    _recoveryGuard.value.uncertainMask&=~(1<<i);
    if (!_recoveryGuard.save()) return false;
    _recoveryState.motors[i].positionHold=false;
    _recoveryState.motors[i].transaction=Transaction::Idle;
    if (_recoveryReady && _recoveryState.batches[i].id[0] && _clock.isReady()) {
      _recoveryState.motors[i].cycle=_recoveryGuard.value.serial[i];
      _recoveryState.motors[i].next=_clock.epoch()+uint32_t(motorInterval(i))*60;
    }
    if (_recoveryReady) requestStateSave();
    logSystem("MANUAL_POSITION_CHECK",String(motor)); return true;
  }
  if(motor<1 || motor>2 || !_recoveryReady || _checkpointTicket || _preparingMotor>=0 ||
      (_profile.value.flags&2) || _turnCycles[0].active || _turnCycles[1].active ||
      !systemReady() || !_clock.isReady() || !_safety.ready(millis())) return false;
  const uint8_t i=motor-1; Motor& m=_recoveryState.motors[i];
  if(!m.positionHold && !(_recoveryGuard.value.uncertainMask&(1<<i))) return false;
  m.positionHold=false; m.transaction=Transaction::Idle;
  if(_recoveryState.batches[i].start) m.next=_clock.epoch()+uint32_t(motorInterval(i))*60;
  _preparingMotor=i;
  const bool accepted=requestCheckpoint(CommitPurpose::Position); _preparingMotor=-1;
  if(!accepted) m.positionHold=true;
  return accepted;
}
void IncubatorController::updateRecovery(uint32_t nowMs) {
  const auto storage=_logger.storage().status();
  if((!storage.available || (storage.loaded && !storage.logging) || _checkpointFault) && !_checkpointTicket && !_turnCycles[0].active &&
      !_turnCycles[1].active && _preparingMotor<0 &&
      uint32_t(nowMs-_lastAutoRecoveryMs)>=HatchConfig::RecoveryRetryIntervalMs) {
    _lastAutoRecoveryMs=nowMs;
    if(retryRecovery()) return;
  }
  if(!_recoveryLoaded) {
    if(!_profile.healthy || !_recoveryGuard.healthy) { _recoveryMessage="Internal storage fault; service required"; return; }
    if(!_logger.storage().loaded(_recoveryPair)) {
      if(uint32_t(nowMs-_recoveryLoadStartedMs)>HatchConfig::RecoveryBootTimeoutMs) _recoveryMessage="SD startup timeout; automatic turning held OFF; retrying automatically";
      return;
    }
    if(!storage.available) { _recoveryLoaded=true; _recoveryMessage="SD unavailable; retrying automatically when a working card is present."; return; }
    if(!_clock.isReady()) { _recoveryMessage="Waiting for automatic clock sync; connect a logged-in browser if the RTC lost time."; return; }
    _activeSnapshot=select(_recoveryPair.valid[0]?&_recoveryPair.state[0]:nullptr,
      _recoveryPair.valid[1]?&_recoveryPair.state[1]:nullptr,_clock.epoch(),_recoveryGuard.value.lastRtc);
    _recoveryLoaded=true;
    if(_activeSnapshot<0) { _recoveryMessage=_recoveryPair.exists[0] || _recoveryPair.exists[1] ? "No valid recovery snapshot; existing files preserved for service. Check clock and card." : "Preparing automatic save from durable device settings."; return; }
    const State& saved=_recoveryPair.state[_activeSnapshot];
    if(_clock.epoch()-saved.rtc>HatchConfig::MaximumUnreviewedOfflineSeconds)
      logSystem("LONG_POWER_GAP","RTC and cutoff determine current batch age; missed turns are not replayed");
    restoreSnapshot(saved);
    _recoveryMessage="Recovered batch dates; validating sensors and saving startup checkpoint";
    if(!requestCheckpoint(CommitPurpose::Startup)) checkpointFailed("Startup checkpoint could not be queued");
  }
  if(_checkpointTicket) {
    if(storage.ack==_checkpointTicket) {
      const CommitPurpose purpose=_commitPurpose; const int8_t motor=_commitMotor;
      _checkpointTicket=0; _activeSnapshot=storage.slot; _recoveryState.sequence=storage.sequence;
      _lastCheckpointMs=nowMs;
      logSystem("CHECKPOINT_VERIFIED",String(storage.sequence));
      if(purpose==CommitPurpose::Startup || purpose==CommitPurpose::Initialize) {
        _recoveryGuard.value.initialized=1; _recoveryGuard.value.lastRtc=_clock.epoch();
        _recoveryReady=_recoveryGuard.save(); _checkpointFault=!_recoveryReady;
        if(_recoveryReady) { _profile.existed=true; _recoveryGuard.existed=true; }
        _recoveryMessage=_recoveryReady ? "Batch timing restored from RTC; outputs recalculated from current sensors" : "Recovery journal write failed";
        forceHeaterOff(nowMs);
        char line[160]; snprintf(line,sizeof(line),"%lu,%u,%lu,%s,%u\n",static_cast<unsigned long>(_clock.epoch()),unsigned(_watchdog.reason),
          static_cast<unsigned long>(storage.sequence),_recoveryReady?"restored":"fault",_recoveryGuard.value.uncertainMask);
        _logger.storage().log(RecoveryStorage::Recovery,line); logSystem("STARTUP_RECOVERY",_recoveryMessage);
      } else if(purpose==CommitPurpose::Pending && motor>=0 && _preparingMotor==motor) {
        if(motorAllowed(motor,nowMs)) {
          _recoveryState.motors[motor].transaction=Transaction::InProgress;
          if(!requestCheckpoint(CommitPurpose::Start)) checkpointFailed("Motor start checkpoint could not be queued");
        } else stopTurnCycle(motor+1);
      } else if(purpose==CommitPurpose::Start && motor>=0 && _preparingMotor==motor) {
        if(motorAllowed(motor,nowMs) && HatchTurning::idle(_turnCycles[0].active,_turnCycles[1].active,nowMs,_motorOffMs)) {
          _turnCycles[motor].start(nowMs,_preparingPulseMs); motorOutput(motor).set(true);
          logMotor(motor,"relay_energized_after_verified_intent"); _preparingMotor=-1;
        } else stopTurnCycle(motor+1);
      } else if((purpose==CommitPurpose::Finish || purpose==CommitPurpose::Position) && motor>=0) {
        Motor& m=_recoveryState.motors[motor];
        if(purpose==CommitPurpose::Position || m.transaction==Transaction::Completed) {
          if(purpose==CommitPurpose::Finish) _finishAwaiting[motor]=false;
          _recoveryGuard.value.uncertainMask&=~(1<<motor); _recoveryGuard.value.lastRtc=_clock.epoch();
          if(!_recoveryGuard.save()) checkpointFailed("Motor recovery journal write failed");
          if(purpose==CommitPurpose::Position) {
            logMotor(motor,"operator_verified_position_no_feedback_sensor");
            if(!_recoveryGuard.value.uncertainMask && (_profile.value.active[0] || _profile.value.active[1])) {
              _profile.value.flags|=2; persistProfile();
            }
          }
        }
      }
    } else if(uint32_t(nowMs-_checkpointRequestedMs)>HatchConfig::RecoveryCommitTimeoutMs) {
      checkpointFailed("SD checkpoint timeout. Motors OFF; verify position and retry recovery.");
    }
  }
  // Empty cards initialize automatically from durable NVS settings. Existing
  // recovery files must validate; corrupt records stay intact for service.
  if (!_recoveryReady && _recoveryLoaded && !_checkpointTicket && !_checkpointFault &&
      !_recoveryPair.exists[0] && !_recoveryPair.exists[1] &&
      _safety.ready(nowMs)) initializeRecovery(true);
  if(!_recoveryReady) return;
  // An OFF/completed motor never waits synchronously for SD. If a periodic
  // checkpoint is still writing, commit COMPLETED immediately after its ack.
  if(!_checkpointFault && !_checkpointTicket) for(uint8_t i=0;i<2;++i) if(_finishAwaiting[i]) {
    _preparingMotor=i;
    requestCheckpoint(CommitPurpose::Finish); _preparingMotor=-1;
    break;
  }
  if(_clock.isReady()) for(uint8_t i=0;i<2;++i) {
    Batch& b=_recoveryState.batches[i];
    if(b.start && !_seenLockdown[i] && _clock.epoch()>=lockdown(b)) {
      _seenLockdown[i]=true; stopTurnCycle(i+1); requestStateSave(); logMotor(i,"lockdown_started");
    }
    if(b.start && (b.status==BatchStatus::Active || b.status==BatchStatus::Paused) && _clock.epoch()>=end(b)) {
      b.status=BatchStatus::Completed; _profile.value.active[i]=false; stopTurnCycle(i+1);
      _recoveryGuard.value.batchStatus[i]=uint8_t(b.status); _recoveryGuard.save();
      persistProfile(); logSystem("INCUBATION_PERIOD_COMPLETE",String(i+1));
    }
  }
  if(!_checkpointFault && !_checkpointTicket && _preparingMotor<0 && !_finishAwaiting[0] && !_finishAwaiting[1] &&
      (_checkpointDirty || uint32_t(nowMs-_lastCheckpointMs)>=HatchConfig::RecoveryCheckpointIntervalMs))
    requestCheckpoint(CommitPurpose::Normal);
  if(_clock.isReady() && uint32_t(nowMs-_lastDiagnosticLogMs)>=HatchConfig::SensorLogIntervalMs) {
    _lastDiagnosticLogMs=nowMs;
    if(storage.errors!=_lastStorageErrors || storage.dropped!=_lastDroppedLogs) {
      logSystem("SD_DIAGNOSTICS",String(storage.error)+"; errors="+String(storage.errors)+"; dropped="+String(storage.dropped));
      _lastStorageErrors=storage.errors; _lastDroppedLogs=storage.dropped;
    }
    if(_currentReading.valid) {
      char line[240]; snprintf(line,sizeof(line),"%lu,%.2f,%.2f,%.2f,%u,%.2f,%s,%u,%u,%u\n",static_cast<unsigned long>(_clock.epoch()),
        _currentReading.temperatureC,_settings.targetTemperatureC,_settings.temperatureOffsetC,_heater.isOn(),0.0, // Legacy pid_percent CSV column remains zero.
        
        _settings.autoMode?"auto":"manual",_safety.high,_safety.low,_safety.critical);
      _logger.storage().log(RecoveryStorage::Temperature,line);
      snprintf(line,sizeof(line),"%lu,%.2f,%.2f\n",static_cast<unsigned long>(_clock.epoch()),_currentReading.humidityPercent,_settings.targetHumidityPercent);
      _logger.storage().log(RecoveryStorage::Humidity,line);
    }
  }
}
void IncubatorController::finishMotor(uint8_t i) {
  motorOutput(i).set(false); _turnCycles[i].active=false; _motorOffMs=millis();
  Motor& m=_recoveryState.motors[i]; m.transaction=Transaction::Completed;
  const uint32_t previousCompleted=m.completed;
  m.completed=_clock.epoch(); m.lastSuccessfulCycle=m.cycle; m.next=m.completed+uint32_t(motorInterval(i))*60;
  if(previousCompleted && m.completed>=previousCompleted)
    _turningMetrics[i].actualTurnIntervalMinutes=min(uint32_t(65535),(m.completed-previousCompleted+30)/60);
  recordTurnEvent(millis(),i); logMotor(i,"timer_completed_physical_position_unverified");
  _finishAwaiting[i]=true;
  if(_checkpointTicket) { requestStateSave(); return; }
  _preparingMotor=i;
  const bool accepted=requestCheckpoint(CommitPurpose::Finish); _preparingMotor=-1;
  if(!accepted) { m.positionHold=true; checkpointFailed("Completion checkpoint failed; motor position requires verification"); }
}
String IncubatorController::buildRecoveryJson() const {
  const auto s=_logger.storage().status();
  String json="{\"version\":1,\"ready\":"+HatchJson::boolValue(_recoveryReady);
  json+=",\"message\":"+HatchJson::quote(_checkpointFault ? _recoveryMessage : !_recoveryReady ? _recoveryMessage : s.error[0] ? String(s.error) : _recoveryMessage);
  json+=",\"sdAvailable\":"+HatchJson::boolValue(s.available)+",\"logging\":"+HatchJson::boolValue(s.logging);
  json+=",\"checkpointPending\":"+HatchJson::boolValue(_checkpointTicket!=0 || _checkpointDirty)+",\"checkpointFault\":"+HatchJson::boolValue(_checkpointFault);
  json+=",\"commitActive\":"+HatchJson::boolValue(_checkpointTicket!=0);
  json+=",\"sequence\":"+String(s.sequence)+",\"lastSaveEpoch\":"+String(s.lastSave);
  json+=",\"errors\":"+String(s.errors)+",\"droppedLogRecords\":"+String(s.dropped);
  json+=",\"canInitialize\":"+HatchJson::boolValue(!_recoveryReady && _recoveryLoaded && !_checkpointTicket && s.available && _clock.isReady() && _profile.healthy && _recoveryGuard.healthy && _safety.ready(millis()));
  uint8_t positionMask=_recoveryGuard.value.uncertainMask; for(uint8_t i=0;i<2;++i) if(_recoveryState.motors[i].positionHold) positionMask|=1<<i;
  json+=",\"positionHoldMask\":"+String(positionMask);
  json+=",\"canRetry\":"+HatchJson::boolValue(!_checkpointTicket && !_turnCycles[0].active && !_turnCycles[1].active && _preparingMotor<0);
  json+=",\"resetReason\":"+String(unsigned(_watchdog.reason))+"}"; return json;
}
