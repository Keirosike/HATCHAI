#pragma once
#include <cstdint>
#include <cmath>
#include <string>
using String=std::string;
constexpr int LOW=0,HIGH=1,OUTPUT=1,INPUT_PULLUP=2;
using portMUX_TYPE=int;
#define portMUX_INITIALIZER_UNLOCKED 0
extern uint32_t fakeMillis,us,base;extern bool stuck;extern uint8_t bytes[5];extern int releases;
inline uint32_t millis(){return fakeMillis;}
inline uint32_t micros(){return us++;}
inline void delayMicroseconds(uint32_t n){us+=n;}
inline void digitalWrite(uint8_t,int){}
inline void pinMode(uint8_t,int mode){if(mode==INPUT_PULLUP){base=us;releases++;}}
inline void portENTER_CRITICAL(portMUX_TYPE*){}
inline void portEXIT_CRITICAL(portMUX_TYPE*){}
inline int digitalRead(uint8_t){if(stuck)return HIGH;uint32_t t=us-base;if(t<20)return HIGH;t-=20;if(t<80)return LOW;t-=80;if(t<80)return HIGH;t-=80;
for(int bit=0;bit<40;++bit){if(t<50)return LOW;t-=50;uint32_t high=(bytes[bit/8]&(128>>(bit%8)))?70:26;if(t<high)return HIGH;t-=high;}return t<50?LOW:HIGH;}
