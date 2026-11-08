#pragma once
#include "NotificationPairingClient.h"
#include "NotificationUtcClock.h"
#include "NotificationHttpParser.h"
#include <array>
#include <type_traits>
namespace HatchPairing {
struct NotificationRequestEnvelope {
  uint64_t generation=0,ticket=0;Operation operation=Operation::ChallengeStart;
  uint32_t queuedAt=0;uint16_t length=0;
  std::array<char,40> path{};std::array<char,2049> body{};
};
struct NotificationCompletionEnvelope {
  uint64_t generation=0,ticket=0;TransportOutcome outcome=TransportOutcome::MalformedResponse;
  int status=0;uint64_t retryAfterMs=0;uint16_t length=0;
  std::array<char,1025> body{};
};
static_assert(std::is_trivially_copyable<NotificationRequestEnvelope>::value,"queue payload must be copyable bytes");
static_assert(std::is_trivially_copyable<NotificationCompletionEnvelope>::value,"queue payload must be copyable bytes");
class NotificationMockIo {
public:
  virtual ~NotificationMockIo(){}
  // Mock callbacks must return promptly and must not re-enter the coordinator.
  virtual bool start(const NotificationRequestEnvelope& request)=0;
  virtual void cancel(uint64_t generation,uint64_t ticket)=0;
};
// Serialized, cooperative simulation only. No task, queue, socket or TLS is created.
class NotificationBackgroundTransport:public Transport {
public:
  NotificationBackgroundTransport(NotificationMockIo& io,NotificationUtcClock& clock):io_(io),clock_(clock){}
  ~NotificationBackgroundTransport();
  NotificationBackgroundTransport(const NotificationBackgroundTransport&)=delete;
  NotificationBackgroundTransport& operator=(const NotificationBackgroundTransport&)=delete;
  void sample(uint32_t now,uint64_t systemUtc){now_=now;utc_=systemUtc;sampled_=true;}
  bool submit(const Outbound& request)override;
  bool submitEnvelope(const NotificationRequestEnvelope& request);
  void abort(uint64_t ticket)override;
  void invalidateBefore(uint64_t generation);
  void pump(uint32_t now,uint64_t systemUtc);
  bool receive(uint64_t generation,uint64_t ticket,const char* http,size_t length,uint32_t now,uint64_t systemUtc);
  bool receiveFragment(uint64_t generation,uint64_t ticket,const char* bytes,size_t length,bool eof,uint32_t now,uint64_t systemUtc);
  bool failure(uint64_t generation,uint64_t ticket,TransportOutcome outcome,uint32_t now,uint64_t systemUtc);
  bool take(NotificationCompletionEnvelope& out);
private:
  NotificationMockIo& io_;NotificationUtcClock& clock_;
  NotificationRequestEnvelope active_,pending_;NotificationCompletionEnvelope done_;
  NotificationHttpStreamParser parser_;
  bool activeReady_=false,pendingReady_=false,doneReady_=false,sampled_=false;
  uint64_t floor_=0,highestGeneration_=0,highestTicket_=0;
  uint32_t now_=0;uint64_t utc_=0;
  void finish(TransportOutcome outcome,int status=0,uint64_t retry=0,const char* body=nullptr,size_t length=0);
};
}
