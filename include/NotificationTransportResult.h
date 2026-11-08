#pragma once
#include <stdint.h>
#include <stddef.h>
namespace HatchPairing {
enum class TransportOutcome { Success, NetworkUnavailable, DnsFailure, TlsVerificationFailure,
  ConnectionTimeout, OperationTimeout, RateLimited, ServerFailure, AuthenticationFailure,
  ValidationFailure, MalformedResponse, Cancelled };
struct TransportResult {
  TransportOutcome outcome=TransportOutcome::Success;
  int httpStatus=200;
  const char* body=nullptr;size_t length=0; // Borrowed only for the duration of complete().
  uint64_t retryAfterMs=0; // Normalized by future HTTP adapter; never a URL/raw header.
};
TransportResult httpTransportResult(int status,const char* body,size_t length,uint64_t retryAfterMs=0);
class NotificationRetryScheduler {
public:
  bool schedule(TransportOutcome outcome,uint32_t now,uint64_t retryAfterMs,uint32_t jitter);
  bool ready(uint32_t now){
    if(!waiting_)return false;
    const uint32_t elapsed=uint32_t(now-since_);since_=now;
    remaining_=elapsed>=remaining_?0:remaining_-elapsed;
    return remaining_==0;
  }
  bool waiting()const{return waiting_;}
  uint64_t delayMs()const{return delay_;}
  unsigned attempts()const{return attempts_;}
  void consume(){waiting_=false;}
  void reset(){waiting_=false;attempts_=0;delay_=0;remaining_=0;}
private:
  bool waiting_=false;unsigned attempts_=0;uint32_t since_=0;uint64_t delay_=0,remaining_=0;
};
}
