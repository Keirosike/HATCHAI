#include "NotificationTaskOwnership.h"
#include <cstring>
namespace HatchPairing {
namespace {
struct MailboxLock {
  NotificationMailboxGuard& guard;
  explicit MailboxLock(NotificationMailboxGuard& g):guard(g){guard.enter();}
  ~MailboxLock(){guard.leave();}
};
void wipeRequest(NotificationRequestEnvelope& r){erase(r.body.data(),r.body.size());r=NotificationRequestEnvelope();}
void wipeCompletion(NotificationCompletionEnvelope& r){erase(r.body.data(),r.body.size());r=NotificationCompletionEnvelope();}
const char* pathFor(Operation op){
  switch(op){
    case Operation::ChallengeStart:case Operation::ChallengeStatus:case Operation::ChallengeCancel:return "/device/pairing/challenge";
    case Operation::Start:return "/device/pairing/start";case Operation::Status:return "/device/pairing/status";case Operation::Cancel:return "/device/pairing/cancel";
  }return "";
}
}
NotificationTaskOwnershipAdapter::~NotificationTaskOwnershipAdapter(){
  // Caller must first stop producers and execute pending cancellations in the owner.
  for(auto& s:slots_)wipeRequest(s.request);wipeCompletion(done_);
}
bool NotificationTaskOwnershipAdapter::claimOwner(){
  MailboxLock lock(guard_);const uintptr_t current=identity_.current();
  if(!current||busy_||stopped_||(owner_&&owner_!=current))return false;owner_=current;return true;
}
bool NotificationTaskOwnershipAdapter::beginOwner(){
  MailboxLock lock(guard_);if(!owner_||owner_!=identity_.current()||busy_||stopped_)return false;busy_=true;return true;
}
void NotificationTaskOwnershipAdapter::endOwner(){MailboxLock lock(guard_);busy_=false;}
bool NotificationTaskOwnershipAdapter::submit(const Outbound& r){
  if(!r.generation||!r.ticket||r.request.method!="POST"||r.request.path.empty()||
    r.request.path!=pathFor(r.operation)||r.request.path.size()>=40||r.request.body.empty()||r.request.body.size()>2048)return false;
  MailboxLock lock(guard_);
  if(!owner_||!sampled_||stopped_||r.ticket<=highestTicket_||r.generation<highestGeneration_)return false;
  for(auto& s:slots_)if(!s.used){
    s.used=true;s.cancelled=false;s.sent=false;s.request=NotificationRequestEnvelope();
    s.request.generation=r.generation;s.request.ticket=r.ticket;s.request.operation=r.operation;
    s.request.queuedAt=sampledNow_;s.request.length=uint16_t(r.request.body.size());
    std::memcpy(s.request.path.data(),r.request.path.data(),r.request.path.size());std::memcpy(s.request.body.data(),r.request.body.data(),r.request.body.size());
    for(auto& older:slots_)if(older.used&&older.request.generation<r.generation)older.cancelled=true;
    if(doneReady_&&done_.generation<r.generation){wipeCompletion(done_);doneReady_=false;}
    highestTicket_=r.ticket;highestGeneration_=r.generation;return true;
  }return false;
}
void NotificationTaskOwnershipAdapter::abort(uint64_t ticket){
  MailboxLock lock(guard_);for(auto& s:slots_)if(s.used&&s.request.ticket==ticket)s.cancelled=true;
  if(doneReady_&&done_.ticket==ticket){wipeCompletion(done_);doneReady_=false;}
}
bool NotificationTaskOwnershipAdapter::ownerStop(){
  if(!beginOwner())return false;
  std::array<uint64_t,2> tickets{};
  {MailboxLock lock(guard_);stopped_=true;size_t at=0;
    for(auto& s:slots_)if(s.used){tickets[at++]=s.request.ticket;wipeRequest(s.request);s.used=false;}
    wipeCompletion(done_);doneReady_=false;
  }
  for(uint64_t ticket:tickets)if(ticket)coordinator_.abort(ticket);
  endOwner();return true;
}
bool NotificationTaskOwnershipAdapter::take(NotificationCompletionEnvelope& out){
  MailboxLock lock(guard_);wipeCompletion(out);if(!doneReady_)return false;
  for(auto& s:slots_)if(s.used&&s.request.ticket==done_.ticket&&s.request.generation==done_.generation&&!s.cancelled){
    out=done_;wipeRequest(s.request);s.used=false;wipeCompletion(done_);doneReady_=false;return true;
  }
  wipeCompletion(done_);doneReady_=false;return false;
}
void NotificationTaskOwnershipAdapter::collect(){
  {MailboxLock lock(guard_);if(doneReady_)return;}
  NotificationCompletionEnvelope out;
  if(!coordinator_.take(out))return;
  {MailboxLock lock(guard_);for(const auto& s:slots_)if(s.used&&!s.cancelled&&s.request.ticket==out.ticket&&s.request.generation==out.generation){
    done_=out;doneReady_=true;break;
  }}wipeCompletion(out);
}
bool NotificationTaskOwnershipAdapter::ownerStep(uint32_t now,uint64_t utc){
  if(!beginOwner())return false;
  std::array<uint64_t,2> cancellations{};
  {MailboxLock lock(guard_);sampled_=true;sampledNow_=now;size_t at=0;
    for(auto& s:slots_)if(s.used&&s.cancelled){cancellations[at++]=s.request.ticket;wipeRequest(s.request);s.used=false;}
  }
  for(uint64_t ticket:cancellations)if(ticket)coordinator_.abort(ticket); // Owner only, outside mailbox lock.
  coordinator_.sample(now,utc);collect();
  // Promote an existing pending request before admitting the next mailbox record.
  coordinator_.pump(now,utc);collect();
  NotificationRequestEnvelope request;bool queued=false;
  {MailboxLock lock(guard_);if(!doneReady_){
    const Slot* first=nullptr;for(const auto& s:slots_)if(s.used&&!s.cancelled&&!s.sent&&(!first||s.request.ticket<first->request.ticket))first=&s;
    if(first){request=first->request;queued=true;}
  }}
  if(queued){
    const bool accepted=coordinator_.submitEnvelope(request);
    {MailboxLock lock(guard_);for(auto& s:slots_)if(s.used&&s.request.ticket==request.ticket){
      s.sent=true;
      if(!accepted&&!s.cancelled){wipeCompletion(done_);done_.ticket=request.ticket;done_.generation=request.generation;
        done_.outcome=TransportOutcome::ValidationFailure;doneReady_=true;}
    }}
  }
  wipeRequest(request);coordinator_.pump(now,utc);collect();endOwner();return true;
}
bool NotificationTaskOwnershipAdapter::ownerFeed(uint64_t generation,uint64_t ticket,const char* data,size_t length,bool eof,uint32_t now,uint64_t utc){
  if(!beginOwner())return false;
  bool cancelled=false;{MailboxLock lock(guard_);for(const auto& s:slots_)if(s.used&&s.request.ticket==ticket&&s.cancelled)cancelled=true;}
  const bool accepted=!cancelled&&coordinator_.receiveFragment(generation,ticket,data,length,eof,now,utc);
  collect();endOwner();return accepted;
}
bool NotificationTaskOwnershipAdapter::ownerFailure(uint64_t generation,uint64_t ticket,TransportOutcome outcome,uint32_t now,uint64_t utc){
  if(!beginOwner())return false;
  bool cancelled=false;{MailboxLock lock(guard_);for(const auto& s:slots_)if(s.used&&s.request.ticket==ticket&&s.cancelled)cancelled=true;}
  const bool accepted=!cancelled&&coordinator_.failure(generation,ticket,outcome,now,utc);collect();endOwner();return accepted;
}
}
