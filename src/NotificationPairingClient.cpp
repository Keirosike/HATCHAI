#include "NotificationPairingClient.h"
#include <ArduinoJson.h>
#include <cstring>

namespace HatchPairing {
namespace {
const uint32_t RequestTimeout = 15000;
const uint32_t CodeLifetime = 300000;
// A timed-out start can still reach Worker before its 60-second challenge
// expires, followed by five-minute code and five-minute grant lifetimes.
const uint32_t MaximumRemoteLifetime = 660000;
const uint32_t PollInterval = 5000;
const char* name(State state) {
  switch(state) {
    case State::Unavailable:return "Unavailable";case State::Idle:return "Idle";
    case State::Requesting:return "Requesting";case State::CodeVisible:return "CodeVisible";
    case State::Redeemed:return "Redeemed";case State::Registered:return "Registered";
    case State::Cancelling:return "Cancelling";case State::Cancelled:return "Cancelled";
    case State::Expired:return "Expired";case State::Error:return "Error";
  }
  return "Error";
}
const char* path(Operation operation) {
  switch(operation) {
    case Operation::ChallengeStart:case Operation::ChallengeStatus:case Operation::ChallengeCancel:return "/device/pairing/challenge";
    case Operation::Start:return "/device/pairing/start";
    case Operation::Status:return "/device/pairing/status";
    case Operation::Cancel:return "/device/pairing/cancel";
  }
  return "";
}
const char* purpose(Operation operation) {
  switch(operation) {
    case Operation::ChallengeStart:case Operation::Start:return "start";
    case Operation::ChallengeStatus:case Operation::Status:return "status";
    case Operation::ChallengeCancel:case Operation::Cancel:return "cancel";
  }
  return "";
}
bool isChallenge(Operation op) {return op==Operation::ChallengeStart||op==Operation::ChallengeStatus||op==Operation::ChallengeCancel;}
}
NotificationPairingClient::NotificationPairingClient(Transport& transport,NonceSource& nonces,NotificationUtcClock& clock):transport_(transport),nonces_(nonces),clock_(&clock){}
#ifdef HATCHAI_PAIRING_TEST
NotificationPairingClient::NotificationPairingClient(Transport& transport,NonceSource& nonces):transport_(transport),nonces_(nonces),clock_(nullptr){}
#endif
NotificationPairingClient::~NotificationPairingClient(){abandon();clearCode();}
bool NotificationPairingClient::elapsed(uint32_t nowMs,uint32_t since,uint32_t interval){return uint32_t(nowMs-since)>=interval;}
PublicStatus NotificationPairingClient::status() const {
  return {state_,error_,pending_||remoteTarget_||retry_.waiting()||state_==State::Requesting||state_==State::Cancelling,code_[0]!=0};
}
std::string NotificationPairingClient::publicStatusJson() const {
  // Construct only from whitelisted enums/flags, never from transport or response text.
  const PublicStatus s=status();
  return std::string("{\"state\":\"")+name(s.state)+"\",\"error\":"+std::to_string(unsigned(s.error))+
    ",\"busy\":"+(s.busy?"true":"false")+",\"codeAvailable\":"+(s.codeAvailable?"true":"false")+"}";
}
void NotificationPairingClient::clearCode(){erase(code_,sizeof(code_));}
void NotificationPairingClient::abandon(){if(pending_)transport_.abort(ticket_);pending_=false;}
bool NotificationPairingClient::advanceGeneration(){
  if(generation_==UINT64_MAX){fail(Error::Exhausted);return false;}++generation_;return true;
}
void NotificationPairingClient::fail(Error error){abandon();clearCode();error_=error;state_=State::Error;}
bool NotificationPairingClient::configure(const Credentials& credentials){
  if(status().busy)return false;
  clearCode();erase(credentials_.key,sizeof(credentials_.key));
  if(!credentials.valid()){
    credentials_.deviceId.clear();credentials_.keyId.clear();credentials_.keyLength=0;
    state_=State::Unavailable;error_=Error::Credentials;return false;
  }
  credentials_=credentials;
  state_=State::Idle;error_=Error::None;return true;
}
bool NotificationPairingClient::send(Operation operation,const std::string& body,uint32_t nowMs){
  if(pending_||ticket_==UINT64_MAX){fail(Error::Exhausted);return false;}
  SignedRequest request;
  if(!sign("POST",path(operation),body,credentials_,request)){fail(Error::Input);return false;}
  ++ticket_;operation_=operation;pending_=true;sentAt_=nowMs;
  Outbound outbound{generation_,ticket_,operation,request};
  if(!transport_.submit(outbound)){fail(Error::Transport);return false;}return true;
}
bool NotificationPairingClient::askChallenge(Operation operation,uint32_t nowMs,uint64_t utcSeconds){
  if(clock_&&!clock_->valid(utcSeconds,nowMs)){fail(Error::Input);return false;}
  if(utcSeconds==0||utcSeconds>9007199254740991ULL){fail(Error::Input);return false;}
  uint8_t bytes[32]={};const bool ok=nonces_.fill(bytes,sizeof(bytes));
  if(ok)requestId_=base64url(bytes,sizeof(bytes));erase(bytes,sizeof(bytes));
  if(!ok){fail(Error::Input);return false;}
  DynamicJsonDocument doc(1024);
  doc["deviceId"]=credentials_.deviceId;doc["keyId"]=credentials_.keyId;
  doc["issuedAt"]=utcSeconds;doc["operation"]=purpose(operation);doc["requestId"]=requestId_;
  std::string body;serializeJson(doc,body);return send(operation,body,nowMs);
}
bool NotificationPairingClient::dispatchOperation(Operation operation,uint32_t nowMs){
  DynamicJsonDocument doc(1024);
  doc["challenge"]=challenge_;doc["deviceId"]=credentials_.deviceId;doc["keyId"]=credentials_.keyId;doc["sessionId"]=session_;
  if(operation!=Operation::Start)doc["pairingId"]=pairingId_;
  else {pairingId_=session_;remoteTarget_=true;issuedAt_=nowMs;}
  std::string body;serializeJson(doc,body);return send(operation,body,nowMs);
}
bool NotificationPairingClient::start(uint32_t nowMs,uint64_t utcSeconds){
  if(status().busy)return false;
  if(!credentials_.valid()){state_=State::Unavailable;error_=Error::Credentials;return false;}
  if(!advanceGeneration())return false;
  clearCode();session_.clear();challenge_.clear();pairingId_.clear();remoteTarget_=false;
  retry_.reset();
  error_=Error::None;state_=State::Requesting;
  return askChallenge(Operation::ChallengeStart,nowMs,utcSeconds);
}
bool NotificationPairingClient::cancel(uint32_t nowMs,uint64_t utcSeconds){
  if(state_==State::Cancelling)return false;
  if(!status().busy&&!remoteTarget_)return false;
  abandon();clearCode();if(!advanceGeneration())return false;error_=Error::None;
  if(!remoteTarget_){state_=State::Cancelled;return true;}
  if(retry_.waiting()){retryOperation_=Operation::ChallengeCancel;state_=State::Cancelling;return true;}
  state_=State::Cancelling;return askChallenge(Operation::ChallengeCancel,nowMs,utcSeconds);
}
bool NotificationPairingClient::requestStatus(uint32_t nowMs,uint64_t utcSeconds){
  if(!remoteTarget_||pending_||retry_.waiting()||state_==State::Cancelling)return false;
  lastPoll_=nowMs;return askChallenge(Operation::ChallengeStatus,nowMs,utcSeconds);
}
void NotificationPairingClient::tick(uint32_t nowMs,uint64_t utcSeconds){
  if(remoteTarget_&&elapsed(nowMs,issuedAt_,MaximumRemoteLifetime)) {
    abandon();clearCode();if(!advanceGeneration())return;remoteTarget_=false;state_=State::Expired;error_=Error::None;return;
  }
  if(state_==State::CodeVisible&&elapsed(nowMs,issuedAt_,CodeLifetime)) {
    abandon();clearCode();if(!advanceGeneration())return;state_=State::Expired;
  }
  if(pending_&&elapsed(nowMs,sentAt_,RequestTimeout)){fail(Error::Timeout);return;}
  if(retry_.waiting()){
    if(retry_.ready(nowMs)){
      retry_.consume();
      // Cancellation/expiry stops automatic work but does not shorten a cooldown.
      if(!remoteTarget_&&(state_==State::Cancelled||state_==State::Expired)){retry_.reset();return;}
      if(retryOperation_==Operation::ChallengeStart)state_=State::Requesting;
      else if(retryOperation_==Operation::ChallengeCancel)state_=State::Cancelling;
      askChallenge(retryOperation_,nowMs,utcSeconds);
    }
    return;
  }
  if(!pending_&&remoteTarget_&&(state_==State::CodeVisible||state_==State::Redeemed||state_==State::Expired)&&elapsed(nowMs,lastPoll_,PollInterval))
    requestStatus(nowMs,utcSeconds);
}
bool NotificationPairingClient::complete(uint64_t generation,uint64_t ticket,const TransportResult& result,
    uint32_t nowMs,uint64_t utcSeconds,uint32_t jitter){
  if(!pending_||generation!=generation_||ticket!=ticket_)return false;
  if(elapsed(nowMs,sentAt_,RequestTimeout)){fail(Error::Timeout);return false;}
  const Operation op=operation_;
  if(result.outcome==TransportOutcome::Success){
    if(result.httpStatus!=200){fail(Error::Protocol);return false;}
    const bool ok=complete(generation,ticket,200,result.body,result.length,nowMs,utcSeconds);
    if(ok&&!isChallenge(op))retry_.reset();
    return ok;
  }
  // No diagnostics or response bodies from failed operations reach public status.
  Error error=Error::Transport;
  if(result.outcome==TransportOutcome::OperationTimeout||result.outcome==TransportOutcome::ConnectionTimeout)error=Error::Timeout;
  else if(result.outcome==TransportOutcome::MalformedResponse)error=Error::Protocol;
  else if(result.outcome==TransportOutcome::AuthenticationFailure||result.outcome==TransportOutcome::ValidationFailure||
    result.outcome==TransportOutcome::RateLimited||result.outcome==TransportOutcome::ServerFailure)error=Error::Remote;
  fail(error);
  // Never re-send Start after an uncertain submission; reconcile the known target.
  retryOperation_=remoteTarget_ ?
    (op==Operation::Cancel||op==Operation::ChallengeCancel?Operation::ChallengeCancel:Operation::ChallengeStatus):Operation::ChallengeStart;
  retry_.schedule(result.outcome,nowMs,result.retryAfterMs,jitter);
  return false;
}
bool NotificationPairingClient::complete(uint64_t generation,uint64_t ticket,int httpStatus,
    const char* response,size_t length,uint32_t nowMs,uint64_t utcSeconds){
  if(!pending_||generation!=generation_||ticket!=ticket_)return false;
  if(elapsed(nowMs,sentAt_,RequestTimeout)){fail(Error::Timeout);return false;}
  const Operation op=operation_;pending_=false;
  if(httpStatus!=200){fail(Error::Remote);return false;}
  if(!response||length>MaxResponse){fail(Error::Protocol);return false;}
  const std::string input(response,length);
  if(!validJson(input)){fail(Error::Protocol);return false;}
  DynamicJsonDocument doc(4096);
  if(deserializeJson(doc,input,DeserializationOption::NestingLimit(MaxDepth+1))||!doc.is<JsonObject>()){
    fail(Error::Protocol);return false;
  }
  if(isChallenge(op)) {
    if(clock_&&!clock_->valid(utcSeconds,nowMs)){fail(Error::Input);return false;}
    if(doc.size()!=3||!doc["sessionId"].is<const char*>()||!doc["challenge"].is<const char*>()||
      !doc["expiresIn"].is<unsigned>()||doc["expiresIn"].as<unsigned>()!=60){fail(Error::Protocol);return false;}
    session_=doc["sessionId"].as<const char*>();challenge_=doc["challenge"].as<const char*>();
    const std::string prefix=std::string(purpose(op))+":";
    if(!validId(session_)||session_!=requestId_||challenge_.compare(0,prefix.size(),prefix)!=0||
      !validId(challenge_.substr(prefix.size()))||(!pairingId_.empty()&&session_==pairingId_)){
      fail(Error::Protocol);return false;
    }
    return dispatchOperation(op==Operation::ChallengeStart?Operation::Start:
      op==Operation::ChallengeStatus?Operation::Status:Operation::Cancel,nowMs);
  }
  if(!doc["pairingId"].is<const char*>()||pairingId_!=doc["pairingId"].as<const char*>()){
    fail(Error::Protocol);return false;
  }
  if(op==Operation::Start) {
    if(doc.size()!=3||!doc["code"].is<const char*>()||!validCode(doc["code"].as<const char*>())||
      !doc["expiresIn"].is<unsigned>()||doc["expiresIn"].as<unsigned>()!=300){fail(Error::Protocol);return false;}
    if(elapsed(nowMs,issuedAt_,CodeLifetime)){clearCode();state_=State::Expired;return false;}
    std::memcpy(code_,doc["code"].as<const char*>(),16);code_[16]=0;
    state_=State::CodeVisible;lastPoll_=nowMs;error_=Error::None;return true;
  }
  if(doc.size()!=2||!doc["state"].is<const char*>()){fail(Error::Protocol);return false;}
  const std::string remote=doc["state"].as<const char*>();
  if(remote=="registered"){clearCode();remoteTarget_=false;state_=State::Registered;}
  else if(remote=="cancelled"){clearCode();remoteTarget_=false;state_=State::Cancelled;}
  else if(remote=="expired"){clearCode();remoteTarget_=false;state_=State::Expired;}
  else if(remote=="redeemed"&&op==Operation::Status){clearCode();state_=State::Redeemed;}
  else if(remote=="issued"&&op==Operation::Status){
    if(code_[0]&&!elapsed(nowMs,issuedAt_,CodeLifetime))state_=State::CodeVisible;
    else{clearCode();state_=State::Expired;}
  } else {fail(Error::Protocol);return false;}
  error_=Error::None;return true;
}
}
