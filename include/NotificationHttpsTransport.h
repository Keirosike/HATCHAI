#pragma once
#include <Arduino.h> // Must precede lwIP headers (Arduino INADDR_NONE declaration).
#include "NotificationTaskOwnership.h"
#include <esp_tls.h>
namespace HatchPairing {
class NotificationHttpsTransport:public NotificationMockIo {
public:
  static constexpr const char* Host="hatchai.kurtzidrickguno-robles.workers.dev";
  void attach(NotificationTaskOwnershipAdapter& owner){owner_=&owner;}
  bool start(const NotificationRequestEnvelope& request)override;
  void cancel(uint64_t generation,uint64_t ticket)override;
  void update(uint32_t now,uint64_t utc);
private:
  enum class Phase { Idle,Dns,Tls,Write,Read } phase_=Phase::Idle;
  NotificationTaskOwnershipAdapter* owner_=nullptr;esp_tls_t* tls_=nullptr;esp_tls_cfg_t config_{};
  uint64_t generation_=0,ticket_=0;uint32_t started_=0,phaseAt_=0,dnsGeneration_=0;
  char address_[48]={},request_[2400]={},read_[512]={};size_t length_=0,sent_=0;
  void close();void fail(TransportOutcome outcome,uint32_t now,uint64_t utc);
};
}
