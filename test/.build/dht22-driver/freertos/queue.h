#pragma once
#include "FreeRTOS.h"
#include <cstring>
struct MockQueue{char bytes[32];unsigned size;bool valid=false;};using QueueHandle_t=MockQueue*;
inline QueueHandle_t xQueueCreate(unsigned,unsigned size){return new MockQueue{{},size,false};}
inline void vQueueDelete(QueueHandle_t q){delete q;}
inline int xQueueOverwrite(QueueHandle_t q,const void* data){memcpy(q->bytes,data,q->size);q->valid=true;return 1;}
inline int xQueuePeek(QueueHandle_t q,void* data,unsigned wait){if(wait!=0)throw 2;if(!q->valid)return 0;memcpy(data,q->bytes,q->size);return 1;}
