#include "RecoveryStorage.h"
#include <SD.h>
#include <SPI.h>
#include <limits.h>

namespace {
const char* slots[]={"/HATCHAI/batch_state_a.json","/HATCHAI/batch_state_b.json"};
const char* paths[]={"/hatchai.csv","/HATCHAI/temperature.csv","/HATCHAI/humidity.csv",
  "/HATCHAI/egg_turning.csv","/HATCHAI/system_events.csv","/HATCHAI/recovery.csv"};
const char* headers[]={
  "timestamp,temperature_c,humidity_percent,mode,bulb1,fan,turner,target_temperature_c,target_humidity_percent,turn_interval_minutes,total_turns,turns_today,last_turn_timestamp,actual_turn_interval_minutes,turner2,turn_interval2_minutes,total_turns2,turns_today2,last_turn2_timestamp,actual_turn_interval2_minutes",
  "rtc,temperature_c,target_c,offset_c,heater_on,pid_percent,mode,high_alarm,low_alarm,critical_alarm",
  "rtc,humidity_percent,target_percent",
  "rtc,motor,cycle_id,transaction,run_seconds,next_scheduled,position_verified,reason",
  "rtc,event,detail",
  "rtc,restart_reason,snapshot_sequence,result,position_hold_mask"};
}
void RecoveryStorage::begin() {
  _commits=xQueueCreate(1,sizeof(Commit)); _logs=xQueueCreate(12,sizeof(Record)); _reloads=xQueueCreate(1,sizeof(uint8_t));
  if(!_commits || !_logs || !_reloads || xTaskCreatePinnedToCore(entry,"hatchai-sd",8192,this,1,&_task,0)!=pdPASS) {
    fault("SD task/queue allocation failed"); portENTER_CRITICAL(&_lock); _status.loaded=true; portEXIT_CRITICAL(&_lock);
  }
}
void RecoveryStorage::entry(void* self) { static_cast<RecoveryStorage*>(self)->run(); }
RecoveryStorage::Status RecoveryStorage::status() const {
  portENTER_CRITICAL(&_lock); Status value=_status; portEXIT_CRITICAL(&_lock); return value;
}
bool RecoveryStorage::loaded(Pair& pair) const {
  portENTER_CRITICAL(&_lock); const bool ready=_status.loaded; if(ready) pair=_pair; portEXIT_CRITICAL(&_lock); return ready;
}
bool RecoveryStorage::reload() {
  if(!_task || !_reloads) return false; uint8_t command=1;
  portENTER_CRITICAL(&_lock); _status.loaded=false; _status.available=false; _status.logging=false; portEXIT_CRITICAL(&_lock);
  xQueueReset(_commits);
  return xQueueSend(_reloads,&command,0)==pdTRUE;
}
uint32_t RecoveryStorage::checkpoint(const HatchRecovery::State& state,int8_t protectedSlot,bool initialize) {
  if(!_task || !_commits || protectedSlot < -1 || protectedSlot > 1 || _ticket==UINT32_MAX) return 0;
  Commit request{state,++_ticket,protectedSlot,initialize};
  return xQueueSend(_commits,&request,0)==pdTRUE ? request.ticket : 0;
}
void RecoveryStorage::dropped() { portENTER_CRITICAL(&_lock); ++_status.dropped; portEXIT_CRITICAL(&_lock); }
void RecoveryStorage::log(Log kind,const char* line) {
  if(!_logs || kind>Recovery || strlen(line)>=sizeof(Record::line)) { dropped(); return; }
  Record r={}; r.kind=kind; strcpy(r.line,line);
  if(xQueueSend(_logs,&r,0)!=pdTRUE) dropped();
}
void RecoveryStorage::fault(const char* message) {
  portENTER_CRITICAL(&_lock); ++_status.errors; _status.logging=false;
  snprintf(_status.error,sizeof(_status.error),"%s",message); portEXIT_CRITICAL(&_lock);
  Serial.printf("[SD] %s\n",message);
}
bool RecoveryStorage::writeVerified(const char* path,const char* bytes,size_t size) {
  if(!size || size>HatchConfig::RecoveryMaxJsonBytes) return false;
  File file=SD.open(path,FILE_WRITE); if(!file) return false;
  const size_t written=file.write(reinterpret_cast<const uint8_t*>(bytes),size); file.flush(); file.close();
  if(written!=size) return false;
  file=SD.open(path,FILE_READ); if(!file || file.size()!=size) { if(file) file.close(); return false; }
  const size_t read=file.read(reinterpret_cast<uint8_t*>(_read),size); file.close();
  return read==size && memcmp(bytes,_read,size)==0;
}
bool RecoveryStorage::readSlot(uint8_t slot,HatchRecovery::State& state) {
  File file=SD.open(slots[slot],FILE_READ); if(!file) return false;
  const size_t length=file.size();
  if(!length || length>HatchConfig::RecoveryMaxJsonBytes) { file.close(); return false; }
  const size_t read=file.read(reinterpret_cast<uint8_t*>(_read),length); file.close();
  return read==length && _codec.decode(_read,length,state);
}
void RecoveryStorage::mount() {
  portENTER_CRITICAL(&_lock); _status.loaded=false; _status.available=false; _status.logging=false;
  _pair=Pair(); portEXIT_CRITICAL(&_lock);
  SD.end();
  SPI.begin(HatchConfig::SdCardSckPin,HatchConfig::SdCardMisoPin,HatchConfig::SdCardMosiPin,HatchConfig::SdCardCsPin);
  bool ready=SD.begin(HatchConfig::SdCardCsPin,SPI,HatchConfig::SdSpiFrequency) && SD.cardType()!=CARD_NONE;
  if(ready) ready=SD.exists("/HATCHAI") || SD.mkdir("/HATCHAI");
  const char* probe="HATCHAI SD readback probe\n";
  if(ready) ready=writeVerified("/HATCHAI/write_probe.tmp",probe,strlen(probe)) && SD.remove("/HATCHAI/write_probe.tmp");
  Pair pair;
  if(ready) for(uint8_t i=0;i<2;++i) { pair.exists[i]=SD.exists(slots[i]); pair.valid[i]=readSlot(i,pair.state[i]); }
  if(!ready) fault("SD unavailable or write/readback probe failed");
  portENTER_CRITICAL(&_lock); _pair=pair; _status.available=ready; _status.logging=ready;
  _status.loaded=true; _status.heartbeat=millis(); if(ready) _status.error[0]=0; portEXIT_CRITICAL(&_lock);
  Serial.printf("[RECOVERY] SD ready=%u; A valid=%u; B valid=%u\n",ready,pair.valid[0],pair.valid[1]);
}
bool RecoveryStorage::archiveInvalid(uint8_t slot) {
  if(!SD.exists(slots[slot])) return true;
  for(uint8_t suffix=0;suffix<32;++suffix) {
    char path[96]; snprintf(path,sizeof(path),"%s.invalid-%lu-%u",slots[slot],static_cast<unsigned long>(millis()),suffix);
    if(!SD.exists(path)) return SD.rename(slots[slot],path);
  }
  return false;
}
bool RecoveryStorage::commit(Commit& request) {
  auto fail=[this,&request](const char* detail) {
    fault(detail);
    portENTER_CRITICAL(&_lock);
    _status.failedTicket=request.ticket;
    snprintf(_status.checkpointError,sizeof(_status.checkpointError),"%s",detail);
    portEXIT_CRITICAL(&_lock);
    return false;
  };
  if(!status().available) return fail("Checkpoint failed: SD not available");
  HatchRecovery::State current[2]; bool valid[2]={readSlot(0,current[0]),readSlot(1,current[1])};
  uint32_t sequence=0; for(uint8_t i=0;i<2;++i) if(valid[i] && current[i].sequence>sequence) sequence=current[i].sequence;
  int8_t protectedSlot=request.protectedSlot;
  if(request.initialize) {
    // Empty-card/rebuild initialization never discards valid snapshots.
    if(valid[0] || valid[1]) return fail("Checkpoint failed: valid snapshots already exist; retry recovery");
    if(!archiveInvalid(0) || !archiveInvalid(1)) return fail("Checkpoint failed: could not preserve invalid snapshot files");
    protectedSlot=-1;
  } else {
    if(protectedSlot<0 || !valid[protectedSlot]) {
      protectedSlot=valid[0] ? 0 : valid[1] ? 1 : -1;
      if(protectedSlot<0) return fail("Checkpoint failed: no readable valid base snapshot");
    }
  }
  if(sequence==UINT32_MAX || request.state.sequence<=sequence) return fail("Checkpoint failed: sequence conflict; retry recovery");
  const int8_t target=protectedSlot==0 ? 1 : 0;
  size_t length=0;
  if(!_codec.encode(request.state,_write,sizeof(_write),length)) return fail("Checkpoint failed: invalid state or JSON capacity exceeded");
  if(!writeVerified(slots[target],_write,length)) return fail("Checkpoint failed: SD write/readback mismatch");
  HatchRecovery::State check;
  if(!readSlot(target,check) || check.sequence!=request.state.sequence) return fail("Checkpoint failed: saved JSON/CRC validation failed");
  portENTER_CRITICAL(&_lock); _status.ack=request.ticket; _status.sequence=check.sequence;
  _status.slot=target; _status.lastSave=check.rtc; if(_status.logging) _status.error[0]=0;
  if(request.initialize) _pair=Pair(); // archived originals are no longer active A/B slots
  _pair.state[target]=check; _pair.valid[target]=true; _pair.exists[target]=true;
  portEXIT_CRITICAL(&_lock);
  Serial.printf("[RECOVERY] Checkpoint %lu verified in %c\n",static_cast<unsigned long>(check.sequence),target?'B':'A');
  // config.json is a derived mirror. A failed mirror/log write cannot invalidate
  // the just-verified recovery snapshot; each failure is reported independently.
  const size_t configLength=_codec.configuration(_write,sizeof(_write));
  const uint32_t configCrc=HatchRecovery::crc32(_write,configLength);
  if(configCrc!=_configCrc) {
    if(writeVerified("/HATCHAI/config.json",_write,configLength)) _configCrc=configCrc;
    else fault("Configuration mirror write failed; snapshots preserved");
  }
  return true;
}
bool RecoveryStorage::rotate(const char* path) {
  char from[96],to[96];
  snprintf(to,sizeof(to),"%s.%u",path,HatchConfig::SdLogArchives);
  if(SD.exists(to) && !SD.remove(to)) return false;
  for(uint8_t i=HatchConfig::SdLogArchives;i>1;--i) {
    snprintf(from,sizeof(from),"%s.%u",path,i-1); snprintf(to,sizeof(to),"%s.%u",path,i);
    if(SD.exists(from) && !SD.rename(from,to)) return false;
  }
  snprintf(to,sizeof(to),"%s.1",path); return SD.rename(path,to);
}
bool RecoveryStorage::append(const Record& r) {
  if(!status().available) return false;
  const char* path=paths[r.kind];
  File file=SD.open(path,FILE_READ);
  if(file) {
    char header[512]={}; size_t n=0;
    while(n<sizeof(header)-1 && file.available()) { int c=file.read(); if(c=='\n' || c<0) break; if(c!='\r') header[n++]=char(c); }
    const uint32_t size=file.size(); file.close();
    if(strcmp(header,headers[r.kind])) {
      char backup[96]; snprintf(backup,sizeof(backup),"%s.legacy-%lu",path,static_cast<unsigned long>(millis()));
      if(SD.exists(backup) || !SD.rename(path,backup)) return false;
    } else if(size>=HatchConfig::SdLogRotateBytes && !rotate(path)) return false;
  }
  if(!SD.exists(path)) {
    snprintf(_write,sizeof(_write),"%s\n",headers[r.kind]);
    if(!writeVerified(path,_write,strlen(_write))) return false;
  }
  file=SD.open(path,FILE_APPEND); if(!file) return false;
  const size_t before=file.size(),size=strlen(r.line);
  const size_t written=file.write(reinterpret_cast<const uint8_t*>(r.line),size); file.flush(); file.close();
  if(written!=size) return false;
  file=SD.open(path,FILE_READ);
  bool ok=file && file.size()==before+size && file.seek(before);
  if(ok) ok=file.read(reinterpret_cast<uint8_t*>(_read),size)==size && memcmp(_read,r.line,size)==0;
  if(file) file.close(); return ok;
}
void RecoveryStorage::run() {
  mount();
  for(;;) {
    portENTER_CRITICAL(&_lock); _status.heartbeat=millis(); portEXIT_CRITICAL(&_lock);
    uint8_t reloadCommand; Commit request; Record record;
    if(xQueueReceive(_reloads,&reloadCommand,0)==pdTRUE) mount();
    if(xQueueReceive(_commits,&request,0)==pdTRUE) commit(request);
    if(xQueueReceive(_logs,&record,pdMS_TO_TICKS(10))==pdTRUE && !append(record)) fault("CSV append/readback failed; record not durable");
    vTaskDelay(1);
  }
}
