#pragma once
#include "NotificationCredentialStore.h"
#include <vector>

namespace HatchUsb {
using TraceHook=void (*)(unsigned,int);
inline TraceHook& traceSink(){static TraceHook hook=nullptr;return hook;}
inline void trace(unsigned stage,int rc=0){if(traceSink())traceSink()(stage,rc);}
enum class Kind : uint8_t { Missing, U8, U32, Blob, Invalid };
struct Value {Kind kind=Kind::Missing;std::vector<uint8_t> bytes;~Value(){HatchPairing::erase(bytes.data(),bytes.size());}};
struct Store {
  virtual ~Store()=default;
  virtual bool read(const char* key,Value& value)=0;
  // Every set/erase must be committed durably before returning true.
  virtual bool write(const char* key,Kind kind,const uint8_t* bytes,size_t length)=0;
  virtual bool remove(const char* key)=0;
  virtual bool reopen()=0;
};
bool digest(const uint8_t* bytes,size_t length,uint8_t out[32]);
bool equal(const uint8_t* a,const uint8_t* b,size_t length);
struct Options {bool resume=false,replace=false;uint32_t expectedGeneration=0;};
enum class Result {Ok,AlreadyVerified,Existing,Pending,Invalid,Io,Readback,Conflict};
struct State {bool any=false,enabled=false,pending=false,valid=false;unsigned active=255;uint32_t generation=0;};
bool inspect(Store& store,State& state);
Result provision(Store& store,const uint8_t* record,size_t length,const Options& options);
Result verifyExisting(Store& store,const uint8_t* record,size_t length);
const char* resultName(Result result);
}
