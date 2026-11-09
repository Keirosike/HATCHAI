#pragma once
#include <cstdint>
#include <cstddef>
namespace HatchUsb {
class WriteGate {
 bool enabled_=false,attempted_=false,used_=false;
public:
 bool allow(uint32_t address,size_t length){
   const bool ok=enabled_&&address>=0x9000&&address<0xe000&&length<=0xe000-address;
   if(!ok)attempted_=true;
   return ok;
 }
 bool authorize(bool authenticated,bool valid,bool unchanged){
   if(used_||!authenticated||!valid||!unchanged||attempted_)return false;
   used_=true;enabled_=true;return true;
 }
 void close(){enabled_=false;}
 bool attempted()const{return attempted_;}
};
}
