// Actual GPIO-pulse driver against a deterministic virtual DHT22 waveform. No hardware.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'.build/dht22-driver');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'Arduino.h'),`#pragma once
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
`);
fs.writeFileSync(path.join(out,'main.cpp'),`#include "Dht22Sensor.h"
#include <cassert>
uint32_t fakeMillis=0,us=0,base=0;bool stuck=false;int releases=0;uint8_t bytes[5]={2,38,1,119,160};
int main(){Dht22Sensor sensor(4);assert(!sensor.read().valid);sensor.begin();assert(!sensor.read().valid);
fakeMillis=2000;auto valid=sensor.read();assert(valid.valid);assert(valid.temperatureC==37.5f);assert(valid.humidityPercent==55);
int previous=releases;assert(!sensor.read().valid);assert(releases==previous);
fakeMillis+=2000;bytes[4]^=1;assert(!sensor.read().valid);assert(sensor.latest().temperatureC==37.5f);bytes[4]^=1;
fakeMillis+=2000;stuck=true;uint32_t start=us;assert(!sensor.read().valid);assert(us-start<8000);stuck=false;
fakeMillis+=2000;assert(sensor.read().valid);
fakeMillis=0xffffff00u;sensor.begin();fakeMillis=0x800u;assert(sensor.read().valid);}
`);
const zig=path.join(root,'test/notification-pairing/.tools/ziglang/zig.exe'),binary=path.join(out,'test.exe');
cp.execFileSync(zig,['c++','-std=c++17','-I'+out,'-I'+path.join(root,'include'),path.join(root,'src/Dht22Sensor.cpp'),path.join(out,'main.cpp'),'-o',binary],{stdio:'inherit'});
cp.execFileSync(binary,[],{stdio:'inherit'});console.log('PASS: actual GPIO DHT22 driver: warmup, decoded waveform, minimum retry interval, checksum rejection, retained sample, bounded stuck pin, recovery and rollover.');
fs.mkdirSync(path.join(out,'freertos'),{recursive:true});
fs.writeFileSync(path.join(out,'freertos/FreeRTOS.h'),`#pragma once
#include <cstdint>
#define pdTRUE 1
#define pdPASS 1
#define pdMS_TO_TICKS(x) (x)
using TaskHandle_t=void*;
`);
fs.writeFileSync(path.join(out,'freertos/queue.h'),`#pragma once
#include "FreeRTOS.h"
#include <cstring>
struct MockQueue{char bytes[32];unsigned size;bool valid=false;};using QueueHandle_t=MockQueue*;
inline QueueHandle_t xQueueCreate(unsigned,unsigned size){return new MockQueue{{},size,false};}
inline void vQueueDelete(QueueHandle_t q){delete q;}
inline int xQueueOverwrite(QueueHandle_t q,const void* data){memcpy(q->bytes,data,q->size);q->valid=true;return 1;}
inline int xQueuePeek(QueueHandle_t q,void* data,unsigned wait){if(wait!=0)throw 2;if(!q->valid)return 0;memcpy(data,q->bytes,q->size);return 1;}
`);
fs.writeFileSync(path.join(out,'freertos/task.h'),`#pragma once
#include "FreeRTOS.h"
extern void(*worker)(void*);extern void* argument;extern unsigned sleeps;extern uint32_t fakeMillis;
inline int xTaskCreatePinnedToCore(void(*fn)(void*),const char*,unsigned stack,void* arg,unsigned priority,TaskHandle_t*,int core){if(stack!=3072||priority!=1||core!=0)throw 3;worker=fn;argument=arg;return 1;}
inline void vTaskDelay(unsigned ms){if(sleeps++==1)throw 1;fakeMillis+=ms;}
`);
fs.writeFileSync(path.join(out,'background.cpp'),`#include "Dht22Sensor.h"
#include <cassert>
uint32_t fakeMillis=0,us=0,base=0;bool stuck=false;int releases=0;uint8_t bytes[5]={2,38,1,119,160};
void(*worker)(void*)=nullptr;void* argument=nullptr;unsigned sleeps=0;
int main(){Dht22Sensor s(4);s.begin();assert(s.startAcquisition());assert(s.startAcquisition());assert(!s.acquisition().valid);
try{worker(argument);}catch(int code){assert(code==1);}
auto r=s.acquisition();assert(r.valid&&r.temperatureC==37.5f);assert(s.latest().humidityPercent==55);assert(fakeMillis==2000);
const auto pins=releases;assert(s.acquisition().valid);assert(s.latest().valid);assert(releases==pins);}
`);
const asyncBinary=path.join(out,'background.exe');
cp.execFileSync(zig,['c++','-std=c++17','-DARDUINO_ARCH_ESP32','-I'+out,'-I'+path.join(root,'include'),path.join(root,'src/Dht22Sensor.cpp'),path.join(out,'background.cpp'),'-o',asyncBinary],{stdio:'inherit'});
cp.execFileSync(asyncBinary,[],{stdio:'inherit'});console.log('PASS: background DHT acquisition owner, fixed queue snapshots, task budget, and zero-wait control-loop reads.');
