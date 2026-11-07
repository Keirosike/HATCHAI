#pragma once
#include <Arduino.h>
#include "Config.h"

// Channel 2 is dedicated to a passive buzzer. No delays in the control loop.
class ChickBuzzer {
public:
  void begin() {
    _enabled=HatchConfig::PassiveBuzzerPin==32 || HatchConfig::PassiveBuzzerPin==33;
    if(!_enabled) return;
    pinMode(HatchConfig::PassiveBuzzerPin,OUTPUT);
    digitalWrite(HatchConfig::PassiveBuzzerPin,LOW);
    ledcSetup(2,HatchConfig::BuzzerToneHz,8);
    ledcAttachPin(HatchConfig::PassiveBuzzerPin,2);
    ledcWrite(2,0);
  }
  void alert() {
    if(!_enabled || (_ever && uint32_t(millis()-_last)<60000))return;
    _ever=true;_active=true;_last=millis();
  }
  void update() {
    if(!_enabled || !_active)return;
    const uint32_t elapsed=millis()-_last;
    if(elapsed>=1200){ledcWrite(2,0);_active=false;return;}
    ledcWrite(2,(elapsed/200)%2==0 ? 128 : 0);
  }
private:
  bool _enabled=false,_active=false,_ever=false;
  uint32_t _last=0;
};
