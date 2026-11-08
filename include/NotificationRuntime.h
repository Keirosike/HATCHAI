#pragma once
#include <Arduino.h>
#include "NotificationHttpsTransport.h"
#include "NotificationIntegrationPolicy.h"
class LcdStatusDisplay;
namespace HatchPairing {
class NotificationRuntime {
public:
  NotificationRuntime();void begin();bool requestStart();void requestCancel();
  String statusJson();void updatePhysicalDisplay(LcdStatusDisplay& display);
private:
  class HardwareNonce:public NonceSource {bool fill(uint8_t* bytes,size_t length)override;};
  NotificationUtcClock clock_;FreeRtosNotificationMailboxGuard mailbox_;FreeRtosNotificationTaskIdentity identity_;
  NotificationHttpsTransport https_;NotificationTaskOwnershipAdapter owner_;HardwareNonce nonce_;NotificationPairingClient client_;
  portMUX_TYPE lock_=portMUX_INITIALIZER_UNLOCKED;
  bool credentials_=false,timeReady_=false,start_=false,cancel_=false,network_=false,taskReady_=false;
  PublicStatus public_{State::Unavailable,Error::Credentials,false,false};char lcdCode_[17]={};uint32_t published_=0,lastStart_=0;
  uint32_t minimumHeap_=0,largestHeap_=0,stackRemaining_=0;TransportOutcome lastOutcome_=TransportOutcome::Success;
  TaskHandle_t task_=nullptr;
  static void entry(void* self);void run();void publish(uint32_t now,bool timeReady);
};
}
