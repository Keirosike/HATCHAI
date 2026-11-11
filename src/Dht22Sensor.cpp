#include "Dht22Sensor.h"
#include "Dht22Protocol.h"
#ifdef ARDUINO_ARCH_ESP32
#include <freertos/task.h>
#endif

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
  // RTOS delay(2) sleeps for scheduler ticks and can stretch the start LOW
  // unpredictably. Use a bounded 1.1 ms protocol pulse outside the receive lock.
  delayMicroseconds(1100);
  uint8_t frame[5]={};uint32_t low=0,high=0;
  portENTER_CRITICAL(&sensorMux);
  pinMode(_pin,INPUT_PULLUP); // Release the data line; never drive it HIGH.
  const uint32_t start=micros();
  // Some devices have already pulled LOW by the first GPIO read. In that case
  // consume the response LOW directly instead of misreading it as a zero-length
  // HIGH. Both paths retain the same bounded response and checksum validation.
  bool ok=(digitalRead(_pin)==LOW || pulse(_pin,HIGH,high,start)) && pulse(_pin,LOW,low,start) &&
    low>=40 && pulse(_pin,HIGH,high,start) && high>=40;
  for(uint8_t bit=0;ok && bit<40;++bit) {
    ok=pulse(_pin,LOW,low,start) && low>=20 &&
      pulse(_pin,HIGH,high,start) && high>=10;
    // DHT22 encodes bits in HIGH duration (~26 us versus ~70 us), not a
    // comparison against the preceding LOW pulse. Reject ambiguous/noisy pulses.
    if(ok) ok=low<=100 && high<=100 && (high<=40 || high>=55);
    if(ok) frame[bit/8]=uint8_t((frame[bit/8]<<1)|(high>=55 ? 1 : 0));
  }
  portEXIT_CRITICAL(&sensorMux);
  reading.timestampMs=millis();
  if(!ok) {reading.error="DHT22 timing/response fault";return reading;}
  if(!HatchDht22::validFrame(frame,sizeof(frame))) {
    reading.error="DHT22 checksum/range fault";return reading;
  }
  reading.temperatureC=HatchDht22::temperature(frame);
  reading.humidityPercent=HatchDht22::humidity(frame);
  reading.valid=true;reading.error="";_latest=reading;return reading;
}

bool Dht22Sensor::startAcquisition(){
#ifdef ARDUINO_ARCH_ESP32
  if(attempts_)return true;
  attempts_=xQueueCreate(1,sizeof(Frame));valid_=xQueueCreate(1,sizeof(Frame));
  TaskHandle_t handle=nullptr;
  if(attempts_&&valid_&&xTaskCreatePinnedToCore(task,"hatchai-dht",3072,this,1,&handle,0)==pdPASS)return true;
  if(attempts_)vQueueDelete(attempts_);if(valid_)vQueueDelete(valid_);
  attempts_=valid_=nullptr;
#endif
  return false;
}
SensorReading Dht22Sensor::latest() const {
#ifdef ARDUINO_ARCH_ESP32
  if(valid_){Frame f{};return xQueuePeek(valid_,&f,0)==pdTRUE?reading(f):SensorReading();}
#endif
  return _latest;
}
SensorReading Dht22Sensor::acquisition() const {
#ifdef ARDUINO_ARCH_ESP32
  if(attempts_){Frame f{};return xQueuePeek(attempts_,&f,0)==pdTRUE?reading(f):SensorReading();}
#endif
  SensorReading r;r.error="DHT22 acquisition unavailable";return r;
}
#ifdef ARDUINO_ARCH_ESP32
SensorReading Dht22Sensor::reading(const Frame& f){SensorReading r;r.temperatureC=f.temperature;r.humidityPercent=f.humidity;r.timestampMs=f.at;r.valid=f.valid;r.error=f.error==0?"":f.error==1?"DHT22 not ready":f.error==2?"DHT22 timing/response fault":"DHT22 checksum/range fault";return r;}
void Dht22Sensor::task(void* argument){
  auto* sensor=static_cast<Dht22Sensor*>(argument);
  vTaskDelay(pdMS_TO_TICKS(HatchConfig::SensorStartupMs));
  for(;;){const auto r=sensor->read();Frame f{r.temperatureC,r.humidityPercent,r.timestampMs,uint8_t(r.valid),uint8_t(r.valid?0:r.error=="DHT22 not ready"?1:r.error=="DHT22 timing/response fault"?2:3)};
    xQueueOverwrite(sensor->attempts_,&f);if(r.valid)xQueueOverwrite(sensor->valid_,&f);
    // DHT22 requires >=2 s; 100 ms margin prevents scheduler-edge rereads.
    vTaskDelay(pdMS_TO_TICKS(2100));
  }
}
#endif
