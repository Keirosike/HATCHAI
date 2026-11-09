#include "write_gate.h"
#include "raw_nvs.h"
#include <cassert>
#include <cstdio>
using namespace HatchUsb;
int main(){
 unsigned checks=0;
 for(unsigned type=0;type<3;++type){WriteGate gate;assert(!gate.allow(0x9000,32));assert(!gate.authorize(true,true,true));checks+=2;}
 for(unsigned mask=0;mask<7;++mask){WriteGate gate;assert(!gate.authorize(mask&1,mask&2,mask&4));assert(!gate.allow(0x9000,1));checks+=2;}
 WriteGate interrupted;interrupted.close();assert(!interrupted.allow(0x9000,32));++checks;
 WriteGate good;assert(good.authorize(true,true,true));assert(good.allow(0x9000,0x5000));assert(!good.allow(0x8000,4096));assert(!good.allow(0xdfff,2));assert(!good.authorize(true,true,true));good.close();assert(!good.allow(0x9000,1));checks+=6;
 uint8_t nvs[0x5000];memset(nvs,255,sizeof(nvs));assert(validateRawNvs(nvs,sizeof(nvs)));++checks;
 // Namespace absent is valid raw NVS; inspection cannot create it.
 uint8_t original[sizeof(nvs)];memcpy(original,nvs,sizeof(nvs));assert(validateRawNvs(nvs,sizeof(nvs)));assert(!memcmp(original,nvs,sizeof(nvs)));checks+=2;
 nvs[0]=0xf8;assert(!validateRawNvs(nvs,sizeof(nvs)));WriteGate damaged;assert(!damaged.authorize(true,validateRawNvs(nvs,sizeof(nvs)),true));assert(!damaged.allow(0x9000,4096));checks+=3;
 memset(nvs,255,sizeof(nvs));nvs[100]=0;assert(!validateRawNvs(nvs,sizeof(nvs)));++checks;
 memset(nvs,255,sizeof(nvs));nvs[0]=0xfe;nvs[8]=0xfe;uint32_t crc=rawCrc(nvs+4,24);memcpy(nvs+28,&crc,4);assert(validateRawNvs(nvs,sizeof(nvs)));nvs[28]^=1;assert(!validateRawNvs(nvs,sizeof(nvs)));checks+=2;
 printf("Authorization/raw NVS checks: %u passed; no hardware accessed\n",checks);
}
