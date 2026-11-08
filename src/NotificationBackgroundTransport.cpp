#include "NotificationBackgroundTransport.h"
#include <cstring>
namespace HatchPairing {
namespace {
const char* expectedPath(Operation op){
  switch(op){
    case Operation::ChallengeStart:case Operation::ChallengeStatus:case Operation::ChallengeCancel:return "/device/pairing/challenge";
    case Operation::Start:return "/device/pairing/start";
    case Operation::Status:return "/device/pairing/status";
    case Operation::Cancel:return "/device/pairing/cancel";
  }return "";
}
void wipe(NotificationRequestEnvelope& r){erase(r.body.data(),r.body.size());r=NotificationRequestEnvelope();}
void wipe(NotificationCompletionEnvelope& r){erase(r.body.data(),r.body.size());r=NotificationCompletionEnvelope();}
}
NotificationBackgroundTransport::~NotificationBackgroundTransport(){
  if(activeReady_)io_.cancel(active_.generation,active_.ticket);
  wipe(active_);wipe(pending_);wipe(done_);
}
bool NotificationBackgroundTransport::submit(const Outbound& r){
  if(r.request.method!="POST"||r.request.path!=expectedPath(r.operation)||r.request.path.empty()||
    r.request.path.size()>=40||r.request.body.empty()||r.request.body.size()>2048)return false;
  NotificationRequestEnvelope e;e.generation=r.generation;e.ticket=r.ticket;e.operation=r.operation;e.queuedAt=now_;e.length=uint16_t(r.request.body.size());
  std::memcpy(e.path.data(),r.request.path.data(),r.request.path.size());std::memcpy(e.body.data(),r.request.body.data(),r.request.body.size());
  const bool accepted=submitEnvelope(e);wipe(e);return accepted;
}
bool NotificationBackgroundTransport::submitEnvelope(const NotificationRequestEnvelope& r){
  if(!sampled_||!clock_.valid(utc_,now_)||pendingReady_||doneReady_||!r.generation||!r.ticket||
    r.generation<floor_||r.generation<highestGeneration_||r.ticket<=highestTicket_||
    !std::memchr(r.path.data(),0,r.path.size())||!expectedPath(r.operation)[0]||
    std::strcmp(r.path.data(),expectedPath(r.operation))||!r.length||r.length>2048)return false;
  pending_=r;
  pendingReady_=true;highestTicket_=r.ticket;highestGeneration_=r.generation;return true;
}
void NotificationBackgroundTransport::abort(uint64_t ticket){
  if(pendingReady_&&pending_.ticket==ticket){wipe(pending_);pendingReady_=false;}
  if(activeReady_&&active_.ticket==ticket){io_.cancel(active_.generation,active_.ticket);wipe(active_);parser_.reset(0);activeReady_=false;}
  if(doneReady_&&done_.ticket==ticket){wipe(done_);doneReady_=false;}
}
void NotificationBackgroundTransport::invalidateBefore(uint64_t generation){
  if(generation>floor_)floor_=generation;
  if(activeReady_&&active_.generation<floor_)abort(active_.ticket);
  if(pendingReady_&&pending_.generation<floor_)abort(pending_.ticket);
  if(doneReady_&&done_.generation<floor_)abort(done_.ticket);
}
void NotificationBackgroundTransport::finish(TransportOutcome outcome,int status,uint64_t retry,const char* body,size_t length){
  wipe(done_);done_.generation=active_.generation;done_.ticket=active_.ticket;
  done_.outcome=outcome;done_.status=status;done_.retryAfterMs=retry;
  if(outcome==TransportOutcome::Success&&body&&length<=1024){std::memcpy(done_.body.data(),body,length);done_.length=uint16_t(length);}
  doneReady_=true;wipe(active_);parser_.reset(0);activeReady_=false;
}
void NotificationBackgroundTransport::pump(uint32_t now,uint64_t utc){
  sample(now,utc);
  const bool timeValid=clock_.valid(utc,now); // Observe even while idle/backpressured.
  if(doneReady_)return; // A full completion slot applies backpressure.
  if(activeReady_){
    if(uint32_t(now-active_.queuedAt)>=12000){io_.cancel(active_.generation,active_.ticket);finish(TransportOutcome::OperationTimeout);}
    else if(!timeValid){io_.cancel(active_.generation,active_.ticket);finish(TransportOutcome::ValidationFailure);}
    return;
  }
  if(!pendingReady_)return;
  active_=pending_;wipe(pending_);pendingReady_=false;activeReady_=true;
  if(uint32_t(now-active_.queuedAt)>=12000){finish(TransportOutcome::OperationTimeout);return;}
  if(!timeValid){finish(TransportOutcome::ValidationFailure);return;}
  parser_.reset(utc);
  if(!io_.start(active_))finish(TransportOutcome::NetworkUnavailable);
}
bool NotificationBackgroundTransport::receive(uint64_t generation,uint64_t ticket,const char* http,size_t length,uint32_t now,uint64_t utc){
  return receiveFragment(generation,ticket,http,length,true,now,utc);
}
bool NotificationBackgroundTransport::receiveFragment(uint64_t generation,uint64_t ticket,const char* http,size_t length,bool eof,uint32_t now,uint64_t utc){
  if(!activeReady_||doneReady_||active_.generation!=generation||active_.ticket!=ticket)return false;
  sample(now,utc);
  if(uint32_t(now-active_.queuedAt)>=12000){io_.cancel(generation,ticket);finish(TransportOutcome::OperationTimeout);return false;}
  if(!clock_.valid(utc,now)){io_.cancel(generation,ticket);finish(TransportOutcome::ValidationFailure);return false;}
  auto state=parser_.feed(http,length);if(eof)state=parser_.end();
  if(state==HttpStreamState::Failed){finish(TransportOutcome::MalformedResponse);return false;}
  if(!eof)return true; // Keep ownership until EOF so later extra bytes can invalidate completion.
  NotificationHttpResponse parsed;if(!parser_.result(parsed)){finish(TransportOutcome::MalformedResponse);return false;}
  finish(parsed.outcome,parsed.status,parsed.retryAfterMs,parsed.body.data(),parsed.length);
  erase(parsed.body.data(),parsed.body.size());return true;
}
bool NotificationBackgroundTransport::failure(uint64_t generation,uint64_t ticket,TransportOutcome outcome,uint32_t now,uint64_t utc){
  if(!activeReady_||doneReady_||active_.generation!=generation||active_.ticket!=ticket||
    outcome==TransportOutcome::Success||outcome==TransportOutcome::RateLimited||outcome==TransportOutcome::ServerFailure)return false;
  sample(now,utc);
  if(uint32_t(now-active_.queuedAt)>=12000){io_.cancel(generation,ticket);finish(TransportOutcome::OperationTimeout);return false;}
  if(!clock_.valid(utc,now)){io_.cancel(generation,ticket);finish(TransportOutcome::ValidationFailure);return false;}
  finish(outcome);return true;
}
bool NotificationBackgroundTransport::take(NotificationCompletionEnvelope& out){
  wipe(out);if(!doneReady_)return false;out=done_;wipe(done_);doneReady_=false;return true;
}
}
