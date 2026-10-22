#pragma once
#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include "RecoveryCodec.h"

class RecoveryStorage {
public:
  enum Log : uint8_t { Legacy, Temperature, Humidity, Turning, Events, Recovery };
  struct Pair { HatchRecovery::State state[2]; bool valid[2]={false,false}; bool exists[2]={false,false}; };
  struct Status {
    bool loaded=false,available=false,logging=false;
    uint32_t ack=0,failedTicket=0,sequence=0,lastSave=0,errors=0,dropped=0,heartbeat=0;
    int8_t slot=-1; char error[96]={},checkpointError[96]={};
  };
  void begin();
  bool reload();
  bool loaded(Pair& pair) const;
  Status status() const;
  uint32_t checkpoint(const HatchRecovery::State& state,int8_t protectedSlot,bool initialize=false);
  void log(Log kind,const char* line);
private:
  struct Commit { HatchRecovery::State state; uint32_t ticket; int8_t protectedSlot; bool initialize; };
  struct Record { Log kind; char line[512]; };
  static void entry(void* self);
  void run();
  void mount();
  bool readSlot(uint8_t slot,HatchRecovery::State& state);
  bool commit(Commit& request);
  bool append(const Record& record);
  bool rotate(const char* path);
  bool archiveInvalid(uint8_t slot);
  bool writeVerified(const char* path,const char* bytes,size_t size);
  void fault(const char* message);
  void dropped();
  mutable portMUX_TYPE _lock=portMUX_INITIALIZER_UNLOCKED;
  Status _status;
  Pair _pair;
  QueueHandle_t _commits=nullptr,_logs=nullptr,_reloads=nullptr;
  TaskHandle_t _task=nullptr;
  uint32_t _ticket=0,_configCrc=0;
  RecoveryCodec _codec;
  char _write[HatchConfig::RecoveryMaxJsonBytes+1]={},_read[HatchConfig::RecoveryMaxJsonBytes+1]={};
};
