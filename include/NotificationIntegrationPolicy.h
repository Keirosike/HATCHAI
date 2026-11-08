#pragma once
#include "NotificationCredentialStore.h"
namespace HatchPairing {
// Explicit UTC conversion: installed prebuilt mbedTLS lacks HAVE_TIME_DATE.
inline bool certificateDateUtc(int year,int month,int day,int hour,int minute,int second,uint64_t& out){
  out=0;
  if(year<1970||year>9999||month<1||month>12||day<1||hour<0||hour>23||minute<0||minute>59||second<0||second>59)return false;
  const bool leap=year%4==0&&(year%100!=0||year%400==0);
  const unsigned months[]={31,28,31,30,31,30,31,31,30,31,30,31};
  if(unsigned(day)>months[month-1]+(month==2&&leap?1:0))return false;
  uint64_t days=365ULL*unsigned(year-1970)+unsigned((year-1)/4-1969/4)-unsigned((year-1)/100-1969/100)+unsigned((year-1)/400-1969/400);
  for(int m=1;m<month;++m)days+=months[m-1]+(m==2&&leap?1:0);
  days+=unsigned(day-1);out=days*86400+unsigned(hour)*3600+unsigned(minute)*60+unsigned(second);return true;
}
inline bool certificateWindowValid(uint64_t utc,uint64_t notBefore,uint64_t notAfter){return notBefore<=notAfter&&utc>=notBefore&&utc<=notAfter;}
// Read-only selected-slot validation shared with native integration tests.
inline bool selectedCredential(unsigned selector,bool enabled,uint32_t selectedGeneration,
    const uint8_t* record,size_t length,Credentials& out){
  erase(out.key,sizeof(out.key));out.keyLength=0;out.deviceId.clear();out.keyId.clear();
  if(selector>1||!enabled||!selectedGeneration)return false;
  uint32_t generation=0;
  if(!decodeCredential(record,length,out,generation)||generation!=selectedGeneration){
    erase(out.key,sizeof(out.key));out.keyLength=0;out.deviceId.clear();out.keyId.clear();return false;
  }return true;
}
inline bool pairingRouteAllowed(bool active,size_t tokenLength,bool matches,bool sameOrigin){
  return active&&tokenLength>=8&&tokenLength<=96&&matches&&sameOrigin;
}
inline bool displayPairingCode(bool visible,uint32_t now,uint32_t updated,bool cancelPending=false){return visible&&!cancelPending&&uint32_t(now-updated)<2000;}
}
