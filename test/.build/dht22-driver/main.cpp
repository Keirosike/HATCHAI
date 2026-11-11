#include "Dht22Sensor.h"
#include <cassert>
uint32_t fakeMillis=0,us=0,base=0;bool stuck=false;int releases=0;uint8_t bytes[5]={2,38,1,119,160};
int main(){Dht22Sensor sensor(4);assert(!sensor.read().valid);sensor.begin();assert(!sensor.read().valid);
fakeMillis=2000;auto valid=sensor.read();assert(valid.valid);assert(valid.temperatureC==37.5f);assert(valid.humidityPercent==55);
int previous=releases;assert(!sensor.read().valid);assert(releases==previous);
fakeMillis+=2000;bytes[4]^=1;assert(!sensor.read().valid);assert(sensor.latest().temperatureC==37.5f);bytes[4]^=1;
fakeMillis+=2000;stuck=true;uint32_t start=us;assert(!sensor.read().valid);assert(us-start<8000);stuck=false;
fakeMillis+=2000;assert(sensor.read().valid);
fakeMillis=0xffffff00u;sensor.begin();fakeMillis=0x800u;assert(sensor.read().valid);}
