#pragma once
#include <cstdint>
constexpr uint8_t DHT22=22;
extern float fakeTemp,fakeHumidity;
extern int reads;
struct DHT{DHT(uint8_t,uint8_t){} void begin(){} float readHumidity(){reads++;return fakeHumidity;} float readTemperature(){return fakeTemp;}};
