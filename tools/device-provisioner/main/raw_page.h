#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
namespace DeviceSetup {
inline uint32_t raw32(const uint8_t* p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
inline uint32_t rawCrc(const uint8_t* p,size_t n){uint32_t c=0;while(n--){c^=*p++;for(int b=0;b<8;++b)c=(c>>1)^(0xedb88320u&uint32_t(-int(c&1)));}return c^0xffffffff;}
inline bool rawErased(const uint8_t* p,size_t n){while(n--)if(*p++!=255)return false;return true;}
inline bool validPage(const uint8_t* page){
 if(rawErased(page,32))return rawErased(page,4096);
 if((raw32(page)!=0xfffffffe&&raw32(page)!=0xfffffffc)||(page[8]!=0xfe&&page[8]!=0xff)||rawCrc(page+4,24)!=raw32(page+28))return false;
 for(unsigned i=0;i<126;){unsigned st=(page[32+i/4]>>(2*(i%4)))&3;if(st==1)return false;if(st!=2){++i;continue;}
  const uint8_t* p=page+64+32*i;unsigned span=p[2];if(!span||span>126-i||!memchr(p+8,0,16))return false;
  uint8_t h[28];memcpy(h,p,4);memcpy(h+4,p+8,24);if(rawCrc(h,28)!=raw32(p+4))return false;
  if(p[1]==0x21||p[1]==0x41||p[1]==0x42){unsigned len=p[24]|unsigned(p[25])<<8;if(len>(span-1)*32||rawCrc(p+32,len)!=raw32(p+28))return false;
   for(unsigned j=1;j<span;++j)if(((page[32+(i+j)/4]>>(2*((i+j)%4)))&3)!=2)return false;
  }else if(span!=1)return false;i+=span;
 }return true;
}
inline bool allowedWrite(bool authorized,uint32_t base,uint32_t size,uint32_t at,uint32_t n){return authorized&&n>0&&at>=base&&at-base<size&&n<=size-(at-base);}
}
