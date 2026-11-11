#pragma once
#include <stdint.h>
namespace HatchSync {
enum class Action { Acknowledge,Discard,Pause,Retry };
class Recovery {
public:
 void reset(){attempts_=0;remaining_=0;}
 bool waiting(uint32_t now){const uint32_t elapsed=now-last_;last_=now;remaining_=elapsed>=remaining_?0:remaining_-elapsed;return remaining_!=0;}
 Action complete(bool received,int status,bool acknowledged,uint64_t retryAfter,uint32_t jitter,uint32_t now){
  last_=now;
  if(received&&status==200&&acknowledged){reset();remaining_=250;return Action::Acknowledge;}
  if(received&&(status==400||status==413)){reset();remaining_=1000;return Action::Discard;}
  if(received&&(status==401||status==403)){reset();return Action::Pause;}
  attempts_=attempts_<6?attempts_+1:6;remaining_=(uint64_t(1000)<<attempts_)+(jitter%1000);
  if(received&&(status==429||status==503)&&retryAfter>remaining_)remaining_=retryAfter;
  return Action::Retry;
 }
 uint64_t delay()const{return remaining_;}
private:unsigned attempts_=0;uint32_t last_=0;uint64_t remaining_=0;
};
}
