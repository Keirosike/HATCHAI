#pragma once
#include "FreeRTOS.h"
extern void(*worker)(void*);extern void* argument;extern unsigned sleeps;extern uint32_t fakeMillis;
inline int xTaskCreatePinnedToCore(void(*fn)(void*),const char*,unsigned stack,void* arg,unsigned priority,TaskHandle_t*,int core){if(stack!=3072||priority!=1||core!=0)throw 3;worker=fn;argument=arg;return 1;}
inline void vTaskDelay(unsigned ms){if(sleeps++==1)throw 1;fakeMillis+=ms;}
