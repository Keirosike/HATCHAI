#include "NotificationTransportResult.h"
namespace HatchPairing {
TransportResult httpTransportResult(int status,const char* body,size_t length,uint64_t retryAfter){
  TransportResult r;r.httpStatus=status;r.body=body;r.length=length;r.retryAfterMs=retryAfter;
  r.outcome=status==200?TransportOutcome::Success:
    status==429?TransportOutcome::RateLimited:
    status==401||status==403?TransportOutcome::AuthenticationFailure:
    status>=500&&status<=599?TransportOutcome::ServerFailure:
    status>=400&&status<=499?TransportOutcome::ValidationFailure:TransportOutcome::MalformedResponse;
  return r;
}
bool NotificationRetryScheduler::schedule(TransportOutcome o,uint32_t now,uint64_t retryAfter,uint32_t jitter){
  waiting_=false;
  const bool transient=o==TransportOutcome::NetworkUnavailable||o==TransportOutcome::DnsFailure||
    o==TransportOutcome::ConnectionTimeout||o==TransportOutcome::OperationTimeout||
    o==TransportOutcome::RateLimited||o==TransportOutcome::ServerFailure;
  if(!transient||attempts_>=3)return false;
  const uint32_t base=1000u<<attempts_;
  uint64_t delay=base+jitter%(base/4+1);
  if(o==TransportOutcome::RateLimited&&retryAfter>delay)delay=retryAfter;
  ++attempts_;since_=now;delay_=delay;remaining_=delay;waiting_=true;return true;
}
}
