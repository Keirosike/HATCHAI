#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
namespace HatchCameraCloud {
constexpr size_t RecordBytes=52;
struct Event {uint8_t camera=0;uint32_t capturedAt=0;char id[37]={};};
inline uint32_t crc(const uint8_t* p,size_t n){uint32_t value=~0U;while(n--){value^=*p++;for(unsigned i=0;i<8;i++)value=(value>>1)^(0xedb88320U&uint32_t(-int32_t(value&1)));}return ~value;}
inline bool valid(const Event& event){if((event.camera!=1&&event.camera!=2)||event.capturedAt<1704067200U||event.capturedAt>=4102444800U||event.id[36]){return false;}for(unsigned i=0;i<36;i++){const char c=event.id[i];if(i==8||i==13||i==18||i==23){if(c!='-'){return false;}}else if(!((c>='0'&&c<='9')||(c>='a'&&c<='f'))){return false;}}return event.id[14]=='4'&&(event.id[19]=='8'||event.id[19]=='9'||event.id[19]=='a'||event.id[19]=='b');}
inline bool encode(const Event& event,uint8_t out[RecordBytes]){if(!valid(event)){return false;}memcpy(out,"CEV2",4);for(unsigned i=0;i<4;i++)out[4+i]=uint8_t(event.capturedAt>>(8*i));memcpy(out+8,event.id,36);out[44]=event.camera;out[45]=out[46]=out[47]=0;const uint32_t check=crc(out,48);for(unsigned i=0;i<4;i++)out[48+i]=uint8_t(check>>(8*i));return true;}
inline bool decode(const uint8_t* data,size_t n,Event& event){event=Event{};if(!data||n!=RecordBytes||memcmp(data,"CEV2",4)){return false;}uint32_t check=0;for(unsigned i=0;i<4;i++)check|=uint32_t(data[48+i])<<(8*i);if(check!=crc(data,48)){return false;}if(data[45]||data[46]||data[47]){return false;}Event candidate;candidate.camera=data[44];for(unsigned i=0;i<4;i++)candidate.capturedAt|=uint32_t(data[4+i])<<(8*i);memcpy(candidate.id,data+8,36);if(!valid(candidate)){return false;}event=candidate;return true;}
}
