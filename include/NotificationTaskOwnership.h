#pragma once
#include "NotificationBackgroundTransport.h"
#if defined(ARDUINO_ARCH_ESP32)
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#endif
namespace HatchPairing {
class NotificationMailboxGuard {
public:
  virtual ~NotificationMailboxGuard(){}
  virtual void enter()=0;
  virtual void leave()=0;
};
class NotificationTaskIdentity {
public:
  virtual ~NotificationTaskIdentity(){}
  virtual uintptr_t current()const=0;
};
#if defined(ARDUINO_ARCH_ESP32)
// Dedicated mailbox lock only; constructing these classes does not create a task.
class FreeRtosNotificationMailboxGuard:public NotificationMailboxGuard {
public:
  void enter()override{portENTER_CRITICAL(&mux_);}
  void leave()override{portEXIT_CRITICAL(&mux_);}
private:
  portMUX_TYPE mux_=portMUX_INITIALIZER_UNLOCKED;
};
class FreeRtosNotificationTaskIdentity:public NotificationTaskIdentity {
public:
  uintptr_t current()const override{return reinterpret_cast<uintptr_t>(xTaskGetCurrentTaskHandle());}
};
#endif
class NotificationTaskOwnershipAdapter:public Transport {
public:
  NotificationTaskOwnershipAdapter(NotificationMockIo& io,NotificationUtcClock& clock,
    NotificationMailboxGuard& guard,NotificationTaskIdentity& identity):coordinator_(io,clock),guard_(guard),identity_(identity){}
  // Lifetime must be quiescent before destruction; no automatic owner transfer.
  bool claimOwner();
  bool ownerStop(); // Quiesce in the owner before destruction; permanently closes admission.
  bool submit(const Outbound& request)override;
  void abort(uint64_t ticket)override;
  bool take(NotificationCompletionEnvelope& out);
  bool ownerStep(uint32_t now,uint64_t utc);
  bool ownerFeed(uint64_t generation,uint64_t ticket,const char* data,size_t length,bool eof,uint32_t now,uint64_t utc);
  bool ownerFailure(uint64_t generation,uint64_t ticket,TransportOutcome outcome,uint32_t now,uint64_t utc);
  ~NotificationTaskOwnershipAdapter();
  NotificationTaskOwnershipAdapter(const NotificationTaskOwnershipAdapter&)=delete;
  NotificationTaskOwnershipAdapter& operator=(const NotificationTaskOwnershipAdapter&)=delete;
private:
  struct Slot {bool used=false,cancelled=false,sent=false;NotificationRequestEnvelope request;};
  NotificationBackgroundTransport coordinator_;
  NotificationMailboxGuard& guard_;NotificationTaskIdentity& identity_;
  std::array<Slot,2> slots_;NotificationCompletionEnvelope done_;
  uintptr_t owner_=0;bool busy_=false,sampled_=false,doneReady_=false,stopped_=false;
  uint32_t sampledNow_=0;uint64_t highestTicket_=0,highestGeneration_=0;
  bool beginOwner();void endOwner();void collect();
};
static_assert(sizeof(NotificationTaskOwnershipAdapter)<=16384,"ownership adapter memory budget exceeded");
}
