#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#include "provision_core.h"
#include <map>
#include <iostream>
#include <stdexcept>
#include <cstring>
using namespace HatchUsb;
using namespace HatchPairing;
namespace HatchUsb {
bool hashFails=false;
bool digest(const uint8_t* bytes,size_t length,uint8_t out[32]){
  if(hashFails)return false;
  BCRYPT_ALG_HANDLE algorithm=nullptr;
  if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)<0)throw std::runtime_error("hash initialization");
  const auto result=BCryptHash(algorithm,nullptr,0,const_cast<PUCHAR>(bytes),ULONG(length),out,32);BCryptCloseAlgorithmProvider(algorithm,0);
  if(result<0)throw std::runtime_error("hash failure");
  return true;
}
}
unsigned checks=0;
void check(bool value,const char* text){if(!value)throw std::runtime_error(text);++checks;}
struct Memory:Store {
  std::map<std::string,Value> values;
  unsigned mutations=0,fail=0;bool after=false,corruptReadback=false;
  bool read(const char* key,Value& v)override{v=Value();auto found=values.find(key);if(found!=values.end())v=found->second;return true;}
  bool write(const char* key,Kind kind,const uint8_t* p,size_t n)override{
    ++mutations;if(mutations==fail&&!after)return false;
    Value v;v.kind=kind;v.bytes.assign(p,p+n);values[key]=v;
    return mutations!=fail;
  }
  bool remove(const char* key)override{++mutations;if(mutations==fail&&!after)return false;values.erase(key);return mutations!=fail;}
  bool reopen()override{
    if(corruptReadback){for(auto key:{"slot0","slot1"}){auto it=values.find(key);if(it!=values.end()&&!it->second.bytes.empty()){it->second.bytes[14]^=1;corruptReadback=false;break;}}}
    return true;
  }
};
CredentialRecord make(const char* kid="controller-v1",uint32_t generation=1,uint8_t start=0){
  Credentials c;c.deviceId=ControllerId;c.keyId=kid;c.keyLength=32;for(unsigned i=0;i<32;++i)c.key[i]=uint8_t(i+start);
  CredentialRecord r;check(encodeCredential(c,generation,r),"production codec encode");return r;
}
Result apply(Memory& m,const CredentialRecord& r,Options options={}){return provision(m,r.bytes.data(),r.length,options);}
bool verified(Memory& m,const CredentialRecord& r){return verifyExisting(m,r.bytes.data(),r.length)==Result::AlreadyVerified;}
bool pending(Memory&m){State s;check(inspect(m,s),"inspect");return s.pending;}
void preservedMarker(Memory&m){check(m.values.at("unrelated-inside-namespace").bytes==std::vector<uint8_t>({1,2,3}),"unrelated key preserved");}
void marker(Memory&m){Value v;v.kind=Kind::Blob;v.bytes={1,2,3};m.values["unrelated-inside-namespace"]=v;}
int main(int argc,char**argv){try{
  auto one=make();
  if(argc==2&&std::string(argv[1])=="--record"){
    constexpr char hex[]="0123456789abcdef";for(size_t i=0;i<one.length;++i)std::cout<<hex[one.bytes[i]>>4]<<hex[one.bytes[i]&15];std::cout<<"\n";return 0;
  }
  Memory first;marker(first);check(apply(first,one)==Result::Ok,"first install");check(verified(first,one),"fresh durable selection");preservedMarker(first);
  Memory hashFailure;HatchUsb::hashFails=true;check(apply(hashFailure,one)==Result::Io&&hashFailure.mutations==0,"hash failure cannot write");HatchUsb::hashFails=false;
  auto saved=first.values;unsigned mutations=first.mutations;
  check(apply(first,one)==Result::Existing&&first.mutations==mutations,"no implicit replacement");
  Options resume;resume.resume=true;check(apply(first,one,resume)==Result::Conflict,"no implicit resume without journal");
  check(verified(first,one)&&first.mutations==mutations,"lost acknowledgement verifies without writes");
  for(unsigned fault=1;fault<=7;++fault)for(bool after:{false,true}){
    Memory m;marker(m);m.fail=fault;m.after=after;check(apply(m,one)!=Result::Ok,"injected install interruption reported");
    m.fail=0;
    if(pending(m))check(apply(m,one,resume)==Result::Ok||verified(m,one),"resume exact install");
    else if(!verified(m,one))check(apply(m,one)==Result::Ok,"retry before any durable mutation");
    check(verified(m,one),"all interruption boundaries converge");preservedMarker(m);
  }
  Memory corrupt;corrupt.corruptReadback=true;check(apply(corrupt,one)==Result::Readback,"failed slot readback");
  State state;inspect(corrupt,state);check(!state.enabled&&state.pending,"failed readback cannot enable");
  check(apply(corrupt,one,resume)==Result::Ok,"retry failed slot readback");
  auto two=make("controller-v2",2,10);Options replacement;replacement.replace=true;replacement.expectedGeneration=1;
  Memory rotate;check(apply(rotate,one)==Result::Ok,"initial rotation fixture");
  check(apply(rotate,two)==Result::Existing,"rotation requires explicit approval");
  check(apply(rotate,two,replacement)==Result::Ok,"approved versioned rotation");
  check(verified(rotate,two)&&equal(rotate.values["slot0"].bytes.data(),one.bytes.data(),one.length),"old inactive slot preserved but not selected");
  for(unsigned fault=1;fault<=7;++fault)for(bool after:{false,true}){
    Memory m;check(apply(m,one)==Result::Ok,"rotation fixture");marker(m);m.mutations=0;m.fail=fault;m.after=after;
    check(apply(m,two,replacement)!=Result::Ok,"injected rotation interruption reported");m.fail=0;
    if(pending(m)){Options recover=replacement;recover.resume=true;check(apply(m,two,recover)==Result::Ok||verified(m,two),"resume approved rotation");}
    else if(!verified(m,two))check(apply(m,two,replacement)==Result::Ok,"retry unstarted rotation");
    check(verified(m,two),"rotation interruption convergence");preservedMarker(m);
  }
  Memory wrong;wrong.fail=3;check(apply(wrong,one)==Result::Io,"pending fixture");wrong.fail=0;
  auto altered=make("controller-v1",1,5);const unsigned before=wrong.mutations;
  check(apply(wrong,altered,resume)==Result::Conflict&&wrong.mutations==before,"different credential cannot resume");
  wrong.values["usb-pending"].bytes[5]^=1;check(apply(wrong,one,resume)==Result::Conflict,"journal corruption detected");
  Memory revoked;check(apply(revoked,one)==Result::Ok,"revocation fixture");uint8_t zero=0;revoked.write("enabled",Kind::U8,&zero,1);mutations=revoked.mutations;
  check(!verified(revoked,one)&&apply(revoked,one,resume)==Result::Conflict&&revoked.mutations==mutations,"revoked selection never auto-reactivated");
  Memory malformed;Value invalid;invalid.kind=Kind::U8;invalid.bytes={2};malformed.values["active"]=invalid;
  check(apply(malformed,one)==Result::Existing&&apply(malformed,two,replacement)==Result::Conflict&&malformed.mutations==0,"invalid selector is not replaced or guessed");
  for(size_t i=0;i<one.length;++i){auto bad=one;bad.bytes[i]^=1;Memory m;check(apply(m,bad)==Result::Invalid&&m.mutations==0,"every record byte corruption rejected");}
  Memory truncated;check(provision(truncated,one.bytes.data(),one.length-1,{})==Result::Invalid,"truncated record rejected");
  auto sameId=make("controller-v1",2,10);Memory same;check(apply(same,one)==Result::Ok,"same-ID fixture");
  check(apply(same,sameId,replacement)==Result::Conflict,"new generation must use a new key ID");
  check(!validKeyId("bad/id")&&!validKeyId("")&&!validKeyId(std::string(65,'x'))&&validKeyId("controller-v1"),"strict key IDs");
  std::cout<<"Provisioning native checks: "<<checks<<" passed; no hardware accessed\n";
}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<"\n";return 1;}}
