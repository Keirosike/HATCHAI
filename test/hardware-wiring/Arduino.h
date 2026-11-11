#pragma once
#include <stdint.h>
#include <cmath>
#include <string>
using String=std::string;
constexpr int LOW=0,HIGH=1,OUTPUT=1,INPUT_PULLUP=2;
using portMUX_TYPE=int;
#define portMUX_INITIALIZER_UNLOCKED 0
void enterCritical();
void exitCritical();
#define portENTER_CRITICAL(mux) enterCritical()
#define portEXIT_CRITICAL(mux) exitCritical()
uint32_t micros();
uint32_t millis();
void delay(uint32_t);
void delayMicroseconds(uint32_t);
int digitalRead(int);
void digitalWrite(int,int);
void pinMode(int,int);
double ledcSetup(int,double,int);
void ledcAttachPin(int,int);
void ledcWrite(int,int);
struct MockSerial { template<class... A> void printf(const char*,A...) {} };
extern MockSerial Serial;
