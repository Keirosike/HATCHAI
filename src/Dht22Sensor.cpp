#include "Dht22Sensor.h"
#include "Dht22Protocol.h"

namespace {
portMUX_TYPE sensorMux=portMUX_INITIALIZER_UNLOCKED;
// Each edge wait and the whole critical section are bounded, including a stuck pin.
bool pulse(uint8_t pin,int level,uint32_t& duration,uint32_t frameStart) {
  const uint32_t start=micros();
  while(digitalRead(pin)==level) {
    if(uint32_t(micros()-start)>=120 || uint32_t(micros()-frameStart)>=6500) return false;
  }
  duration=uint32_t(micros()-start);
  return true;
}
}

void Dht22Sensor::begin() {
  pinMode(_pin,INPUT_PULLUP);
  _startedMs=millis();_initialized=true;
}

SensorReading Dht22Sensor::read() {
  SensorReading reading;reading.timestampMs=millis();
  if(!_initialized || uint32_t(reading.timestampMs-_startedMs)<HatchConfig::SensorStartupMs) {
    reading.error="DHT22 not ready";return reading;
  }
  if(_attempted && uint32_t(reading.timestampMs-_lastAttemptMs)<2000) {
    reading.error="DHT22 not ready";return reading;
  }
  _attempted=true;_lastAttemptMs=reading.timestampMs;
  digitalWrite(_pin,LOW);pinMode(_pin,OUTPUT);
  delay(2); // DHT22 start pulse; outside the timing-critical receive section.
  uint8_t frame[5]={};uint32_t low=0,high=0;
  portENTER_CRITICAL(&sensorMux);
  pinMode(_pin,INPUT_PULLUP); // Release the data line; never drive it HIGH.
  const uint32_t start=micros();
  bool ok=pulse(_pin,HIGH,high,start) && pulse(_pin,LOW,low,start) &&
    low>=40 && pulse(_pin,HIGH,high,start) && high>=40;
  for(uint8_t bit=0;ok && bit<40;++bit) {
    ok=pulse(_pin,LOW,low,start) && low>=20 &&
      pulse(_pin,HIGH,high,start) && high>=10;
    if(ok) frame[bit/8]=uint8_t((frame[bit/8]<<1)|(high>low ? 1 : 0));
  }
  portEXIT_CRITICAL(&sensorMux);
  reading.timestampMs=millis();
  if(!ok) {reading.error="DHT22 frame invalid";return reading;}
  if(!HatchDht22::validFrame(frame,sizeof(frame))) {
    reading.error="DHT22 frame invalid";return reading;
  }
  reading.temperatureC=HatchDht22::temperature(frame);
  reading.humidityPercent=HatchDht22::humidity(frame);
  reading.valid=true;reading.error="";_latest=reading;return reading;
}
