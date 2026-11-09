#include "provision_core.h"
#include <cstring>
#include <limits>
using namespace HatchPairing;
namespace HatchUsb {
namespace {
const char* fields[]={"active","enabled","generation","slot0","slot1","usb-pending"};
void put32(uint8_t* p,uint32_t n){for(unsigned i=0;i<4;++i)p[i]=uint8_t(n>>(8*i));}
uint32_t get32(const uint8_t* p){return uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);}
uint32_t crc(const uint8_t* p,size_t n){uint32_t c=0xffffffff;for(size_t i=0;i<n;++i){c^=p[i];for(unsigned b=0;b<8;++b)c=(c>>1)^(0xedb88320u&uint32_t(0-int(c&1)));}return ~c;}
bool scalar(const Value& v,Kind kind,size_t size){return v.kind==kind&&v.bytes.size()==size;}
bool set8(Store& s,const char* key,uint8_t v){return s.write(key,Kind::U8,&v,1);}
bool set32(Store& s,const char* key,uint32_t v){uint8_t b[4];put32(b,v);return s.write(key,Kind::U32,b,4);}
bool matches(Store& s,const char* key,const uint8_t* bytes,size_t n){Value v;return s.read(key,v)&&v.kind==Kind::Blob&&v.bytes.size()==n&&equal(v.bytes.data(),bytes,n);}
bool selected(Store& s,const uint8_t* record,size_t n,uint32_t generation){
  State state;if(!inspect(s,state)||!state.valid||!state.enabled||state.generation!=generation)return false;
  return matches(s,state.active==0?"slot0":"slot1",record,n);
}
}
bool equal(const uint8_t* a,const uint8_t* b,size_t n){uint8_t difference=0;for(size_t i=0;i<n;++i)difference|=a[i]^b[i];return difference==0;}
bool inspect(Store& s,State& state){
  state=State();Value values[6];for(unsigned i=0;i<6;++i){if(!s.read(fields[i],values[i]))return false;state.any|=values[i].kind!=Kind::Missing;}
  state.pending=values[5].kind!=Kind::Missing;
  if(scalar(values[0],Kind::U8,1))state.active=values[0].bytes[0];
  state.enabled=scalar(values[1],Kind::U8,1)&&values[1].bytes[0]==1;
  if(scalar(values[2],Kind::U32,4))state.generation=get32(values[2].bytes.data());
  if(state.active<=1){const auto& v=values[3+state.active];Credentials c;uint32_t g=0;
    state.valid=v.kind==Kind::Blob&&decodeCredential(v.bytes.data(),v.bytes.size(),c,g)&&g==state.generation;}
  return true;
}
Result provision(Store& s,const uint8_t* record,size_t n,const Options& options){
  Credentials incoming;uint32_t generation=0;
  if(!decodeCredential(record,n,incoming,generation))return Result::Invalid;
  State state;if(!inspect(s,state))return Result::Io;
  uint8_t hash[32];if(!digest(record,n,hash))return Result::Io;
  // Journal binds resume to the exact intended record, generation and destination slot.
  // It is local recovery metadata, not an authentication credential.
  uint8_t journal[46]={ 'H','U','P','1',0,0,0,0,0,0 };
  journal[4]=1;put32(journal+6,generation);std::memcpy(journal+10,hash,32);
  if(state.pending){
    Value pending;if(!s.read("usb-pending",pending))return Result::Io;
    if(!options.resume)return Result::Pending;
    if(pending.kind!=Kind::Blob||pending.bytes.size()!=sizeof(journal)||
      !equal(pending.bytes.data(),journal,5)||pending.bytes[5]>1||
      !equal(pending.bytes.data()+6,journal+6,36)||get32(pending.bytes.data()+42)!=crc(pending.bytes.data(),42))return Result::Conflict;
    journal[5]=pending.bytes[5];
    if(selected(s,record,n,generation))return s.remove("usb-pending")?Result::AlreadyVerified:Result::Io;
    // An interrupted transaction must never leave an unrelated active key eligible for resume.
    if(state.enabled&&(!options.replace||!state.valid||state.generation!=options.expectedGeneration||
      state.generation==UINT32_MAX||generation!=state.generation+1||state.active==journal[5]))return Result::Conflict;
  }else{
    if(options.resume)return Result::Conflict;
    if(state.any){
      if(!options.replace)return Result::Existing;
      if(!state.valid||state.generation!=options.expectedGeneration||state.generation==UINT32_MAX||generation!=state.generation+1)return Result::Conflict;
      Value old;if(!s.read(state.active==0?"slot0":"slot1",old))return Result::Io;
      Credentials current;uint32_t g=0;
      if(!decodeCredential(old.bytes.data(),old.bytes.size(),current,g)||current.keyId==incoming.keyId)return Result::Conflict;
      journal[5]=state.active==0?1:0;
    }else if(generation!=1||options.replace)return Result::Conflict;
    put32(journal+42,crc(journal,42));
    trace(60);if(!s.write("usb-pending",Kind::Blob,journal,sizeof(journal)))return Result::Io;trace(61);
  }
  // Journal first makes even a power loss before disabling recoverable. Activation is last.
  trace(62);if(!set8(s,"enabled",0))return Result::Io;trace(63);
  const char* slot=journal[5]==0?"slot0":"slot1";
  trace(64);if(!s.write(slot,Kind::Blob,record,n)||!s.reopen())return Result::Io;trace(65);
  if(!matches(s,slot,record,n))return Result::Readback;
  trace(66);if(!set32(s,"generation",generation)||!set8(s,"active",journal[5])||!s.reopen())return Result::Io;trace(67);
  State prepared;if(!inspect(s,prepared)||prepared.enabled||!prepared.valid||prepared.active!=journal[5]||prepared.generation!=generation)return Result::Readback;
  trace(68);if(!set8(s,"enabled",1)||!s.reopen())return Result::Io;trace(69);
  if(!selected(s,record,n,generation))return Result::Readback;
  return s.remove("usb-pending")?Result::Ok:Result::Io;
}
Result verifyExisting(Store& s,const uint8_t* record,size_t n){
  Credentials c;uint32_t g=0;if(!decodeCredential(record,n,c,g))return Result::Invalid;
  State state;if(!inspect(s,state))return Result::Io;
  if(state.pending)return Result::Pending;
  return selected(s,record,n,g)?Result::AlreadyVerified:Result::Conflict;
}
const char* resultName(Result r){switch(r){case Result::Ok:return "ok";case Result::AlreadyVerified:return "already_verified";case Result::Existing:return "existing_credentials";case Result::Pending:return "pending_transaction";case Result::Invalid:return "invalid_record";case Result::Readback:return "readback_failed";case Result::Conflict:return "recovery_conflict";default:return "storage_failed";}}
}
