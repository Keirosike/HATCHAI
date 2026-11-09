#pragma once
#include <cstdint>
#include <cstddef>
#include <cstring>
namespace HatchUsb {
inline uint32_t raw32(const uint8_t* p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
inline uint32_t rawCrc(const uint8_t* p,size_t n){uint32_t c=0;for(size_t i=0;i<n;++i){c^=p[i];for(unsigned b=0;b<8;++b)c=(c>>1)^(0xedb88320u&uint32_t(-int32_t(c&1)));}return c^0xffffffff;}
inline bool rawErased(const uint8_t* p,size_t n){for(size_t i=0;i<n;++i)if(p[i]!=255)return false;return true;}
inline bool validateRawNvs(const uint8_t* bytes,size_t size){
 if(size!=0x5000)return false;
 for(size_t offset=0;offset<size;offset+=4096){const uint8_t* page=bytes+offset;
  if(rawErased(page,32)){if(!rawErased(page,4096))return false;continue;}
  if((raw32(page)!=0xfffffffe&&raw32(page)!=0xfffffffc)||(page[8]!=0xfe&&page[8]!=0xff)||rawCrc(page+4,24)!=raw32(page+28))return false;
  for(unsigned slot=0;slot<126;){unsigned state=(page[32+slot/4]>>(2*(slot%4)))&3;
   if(state==1)return false;
   if(state!=2){++slot;continue;}
   const uint8_t* p=page+64+slot*32;unsigned span=p[2];
   if(!span||span>126-slot||!memchr(p+8,0,16))return false;
   uint8_t header[28];memcpy(header,p,4);memcpy(header+4,p+8,24);
   if(rawCrc(header,28)!=raw32(p+4))return false;
   if(p[1]==0x21||p[1]==0x41||p[1]==0x42){unsigned len=p[24]|unsigned(p[25])<<8;
    if(len>(span-1)*32)return false;
    for(unsigned j=1;j<span;++j)if(((page[32+(slot+j)/4]>>(2*((slot+j)%4)))&3)!=2)return false;
    if(rawCrc(p+32,len)!=raw32(p+28))return false;
   }else if(span!=1)return false;
   slot+=span;
  }
 }
 return true;
}
}
