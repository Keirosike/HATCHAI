#include "NotificationCredentialStore.h"
#include <cstring>
#include <limits.h>

namespace HatchPairing {
namespace {
void clear(Credentials& c){erase(c.key,sizeof(c.key));c.keyLength=0;c.deviceId.clear();c.keyId.clear();}
void put32(uint8_t* p,uint32_t n){for(unsigned i=0;i<4;++i)p[i]=uint8_t(n>>(8*i));}
uint32_t get32(const uint8_t* p){uint32_t n=0;for(unsigned i=0;i<4;++i)n|=uint32_t(p[i])<<(8*i);return n;}
uint32_t crc(const uint8_t* p,size_t n){uint32_t c=0xffffffff;for(size_t i=0;i<n;++i){c^=p[i];for(unsigned b=0;b<8;++b)c=(c>>1)^(0xedb88320u&uint32_t(0-int(c&1)));}return ~c;}
}
bool encodeCredential(const Credentials& c,uint32_t generation,CredentialRecord& out){
  out.clear();if(!c.valid()||!generation)return false;
  // Explicit wire bytes, little-endian integers. No struct padding is persisted.
  const size_t n=14+c.deviceId.size()+c.keyId.size()+32+4;
  if(n>out.bytes.size())return false;
  uint8_t* p=out.bytes.data();std::memcpy(p,"HNPC",4);p[4]=1;p[5]=0;
  p[6]=uint8_t(n);p[7]=uint8_t(c.deviceId.size());p[8]=uint8_t(c.keyId.size());p[9]=32;
  put32(p+10,generation);size_t at=14;
  std::memcpy(p+at,c.deviceId.data(),c.deviceId.size());at+=c.deviceId.size();
  std::memcpy(p+at,c.keyId.data(),c.keyId.size());at+=c.keyId.size();
  std::memcpy(p+at,c.key,32);put32(p+n-4,crc(p,n-4));out.length=n;return true;
}
bool decodeCredential(const uint8_t* p,size_t n,Credentials& out,uint32_t& generation){
  clear(out);generation=0;
  if(!p||n<51||n>CredentialRecordCapacity||std::memcmp(p,"HNPC",4)||p[4]!=1||p[5]!=0||p[6]!=n||
    p[7]!=std::strlen(ControllerId)||p[8]<1||p[8]>64||p[9]!=32||n!=size_t(14+p[7]+p[8]+32+4)||
    !get32(p+10)||get32(p+n-4)!=crc(p,n-4))return false;
  Credentials c;c.deviceId.assign(reinterpret_cast<const char*>(p+14),p[7]);
  c.keyId.assign(reinterpret_cast<const char*>(p+14+p[7]),p[8]);c.keyLength=32;
  std::memcpy(c.key,p+14+p[7]+p[8],32);if(!c.valid())return false;
  out=c;generation=get32(p+10);return true;
}
bool MockNotificationCredentialStore::load(Credentials& out,uint32_t& generation) const {
  clear(out);generation=0;
  return (active==0||active==1)&&!revoked_[active]&&
    decodeCredential(slots[active].bytes.data(),slots[active].length,out,generation);
}
bool MockNotificationCredentialStore::rotate(const Credentials& next,uint32_t generation){
  const Fault fault=nextFault;nextFault=Fault::None;
  // Missing selector is acceptable only for genuinely empty, first-time storage.
  if(active!=0&&active!=1){if(active!=-1||slots[0].length||slots[1].length)return false;}
  else {
    Credentials current;uint32_t previous=0;
    if(!load(current,previous)||generation<=previous||current.keyId==next.keyId)return false;
  }
  CredentialRecord record;if(!encodeCredential(next,generation,record))return false;
  const int target=active==0?1:0;
  slots[target]=record;revoked_[target]=true; // Not usable until readback and selector commit.
  if(fault==Fault::InterruptedWrite){slots[target].length/=2;return false;}
  if(fault==Fault::FailedReadback)slots[target].bytes[14]^=1;
  Credentials check;uint32_t checkGeneration=0;
  if(!decodeCredential(slots[target].bytes.data(),slots[target].length,check,checkGeneration)||
    checkGeneration!=generation||slots[target].length!=record.length||
    std::memcmp(slots[target].bytes.data(),record.bytes.data(),record.length))return false;
  if(fault==Fault::SelectorWrite)return false;
  if(active==0||active==1)revoked_[active]=true;
  revoked_[target]=false;active=target;return true;
}
void MockNotificationCredentialStore::revokeSelected(){if(active==0||active==1)revoked_[active]=true;}
}
