#include "Dht22Sensor.h"
#include <cassert>
uint32_t fakeMillis=0,us=0,base=0;bool stuck=false;int releases=0;uint8_t bytes[5]={2,38,1,119,160};
void(*worker)(void*)=nullptr;void* argument=nullptr;unsigned sleeps=0;
int main(){Dht22Sensor s(4);s.begin();assert(s.startAcquisition());assert(s.startAcquisition());assert(!s.acquisition().valid);
try{worker(argument);}catch(int code){assert(code==1);}
auto r=s.acquisition();assert(r.valid&&r.temperatureC==37.5f);assert(s.latest().humidityPercent==55);assert(fakeMillis==2000);
const auto pins=releases;assert(s.acquisition().valid);assert(s.latest().valid);assert(releases==pins);}
