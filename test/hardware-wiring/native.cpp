#include "Dht22Sensor.h"
#include "OutputDevice.h"
#include "ChickBuzzer.h"
#include "RecoveryCodec.h"
#include "BatchDisplay.h"
#include <cassert>
#include <iostream>
#include <vector>
MockSerial Serial;
uint32_t nowUs=0,releaseUs=0,criticalStart=0,maxCritical=0;
int gpioWrites=0,gpioModes=0,lastPin=-1,lastLevel=-1,buzzerPin=-1,duty=0;
bool stuck=false;
std::vector<int> pulses;
uint32_t micros(){return nowUs++;}
uint32_t millis(){return nowUs/1000;}
void delay(uint32_t ms){nowUs+=ms*1000;}
void delayMicroseconds(uint32_t us){assert(us==1100);nowUs+=us;}
void enterCritical(){criticalStart=nowUs;}
void exitCritical(){maxCritical=std::max(maxCritical,nowUs-criticalStart);}
void digitalWrite(int pin,int level){assert(pin>=0);++gpioWrites;lastPin=pin;lastLevel=level;}
void pinMode(int pin,int mode){assert(pin>=0);++gpioModes;if(pin==4 && mode==INPUT_PULLUP)releaseUs=nowUs;}
int digitalRead(int pin){assert(pin==4);if(stuck)return HIGH;uint32_t elapsed=nowUs-releaseUs;int level=HIGH;for(int length:pulses){if(elapsed<uint32_t(length))return level;elapsed-=length;level=!level;}return LOW;}
double ledcSetup(int channel,double frequency,int bits){assert(channel==2&&bits==8);return frequency;}
void ledcAttachPin(int pin,int channel){assert(channel==2);buzzerPin=pin;}
void ledcWrite(int channel,int value){assert(channel==2);duty=value;}
void frame(const uint8_t* bytes){pulses={20,80,80};for(int bit=0;bit<40;++bit){pulses.push_back(50);pulses.push_back(bytes[bit/8]&(0x80>>(bit%8))?70:26);}pulses.push_back(50);}
void resign(JsonDocument& doc,std::string& text){doc.remove("crc32");std::string raw;serializeJson(doc,raw);doc["crc32"]=HatchRecovery::crc32(raw.data(),raw.size());text.clear();serializeJson(doc,text);}
int main(){
  OutputDevice fan(-1,false,"Fan");fan.begin();fan.set(false);fan.set(true);
  assert(gpioWrites==0&&gpioModes==0&&fan.isOn()&&fan.pin()==-1);
  OutputDevice heater(HatchConfig::Bulb1RelayPin,false,"Heater");heater.begin();assert(lastPin==14&&lastLevel==HIGH);heater.set(true);assert(lastLevel==LOW);heater.set(false);assert(lastLevel==HIGH);
  ChickBuzzer buzzer;buzzer.begin();assert(buzzerPin==27&&duty==0);buzzer.alert();buzzer.update();assert(duty==128);delay(1201);buzzer.update();assert(duty==0);
  Dht22Sensor sensor(4);sensor.begin();assert(!sensor.read().valid);delay(2001);
  const uint8_t good[]={2,38,1,121,162};frame(good);auto reading=sensor.read();assert(reading.valid&&std::abs(reading.temperatureC-37.7f)<0.01f&&reading.humidityPercent==55);
  assert(!sensor.read().valid);delay(2101);const uint8_t corrupt[]={2,38,1,121,163};frame(corrupt);assert(!sensor.read().valid);assert(sensor.latest().valid);
  delay(2101);frame(good);pulses[0]=0; // Sensor response already LOW at release.
  assert(sensor.read().valid);
  delay(2101);frame(good);for(size_t n=3;n<pulses.size()-1;n+=2)pulses[n]=85; // Longer LOW must not corrupt HIGH-duration bits.
  assert(sensor.read().valid);
  delay(2101);frame(good);pulses[4]=47;assert(!sensor.read().valid); // Ambiguous pulse rejected.
  delay(2101);stuck=true;assert(!sensor.read().valid);assert(maxCritical<=6505);stuck=false;
  RecoveryCodec codec;HatchRecovery::State state;char encoded[4096];size_t size=0;assert(codec.encode(state,encoded,sizeof(encoded),size));HatchRecovery::State restored;assert(codec.decode(encoded,size,restored));
  HatchRecovery::Batch metadata;
  assert(HatchDisplay::applyMetadata(metadata,"existing",123,"existing","FLOCK A","Chicken Batch",12));
  assert(std::string(metadata.id)=="existing"&&metadata.start==123&&std::string(metadata.label)=="FLOCK A"&&metadata.eggCount==12);
  assert(!HatchDisplay::applyMetadata(metadata,"other",124,"existing","WRONG","Wrong",1));
  assert(!HatchDisplay::applyMetadata(metadata,"existing",123,"existing",std::string(31,'X').c_str(),"Name",1));
  assert(std::string(metadata.label)=="FLOCK A"&&metadata.start==123);
  DynamicJsonDocument doc(6144);assert(!deserializeJson(doc,encoded,size));doc["config"]["heaterPin"]=27;doc["config"]["fanPin"]=14;doc["config"]["fanAlwaysOn"]=false;doc["config"]["fanPolicy"]="auto_or_safety_override";std::string text;resign(doc,text);assert(codec.decode(text.data(),text.size(),restored));
  doc["config"]["heaterPin"]=4;resign(doc,text);assert(!codec.decode(text.data(),text.size(),restored));doc["config"]["heaterPin"]=14;
  doc["config"]["fanPin"]=4;resign(doc,text);assert(!codec.decode(text.data(),text.size(),restored));
  std::cout<<"PASS: fan has zero GPIO access; relay polarity; GPIO14 heater and GPIO27 buzzer; DHT22 valid/checksum/interval/stuck-line bounds; current and legacy recovery roundtrips; invalid pin rejected\n";
}
