#pragma once
#include <stddef.h>
#include <stdint.h>

namespace HatchDht22 {
constexpr float temperature(const uint8_t* frame) {
  return ((uint16_t(frame[2]&0x7f)<<8)|frame[3]) * (frame[2]&0x80 ? -0.1f : 0.1f);
}
constexpr float humidity(const uint8_t* frame) {
  return ((uint16_t(frame[0])<<8)|frame[1])*0.1f;
}
constexpr bool validFrame(const uint8_t* frame,size_t size) {
  return size==5 && uint8_t(frame[0]+frame[1]+frame[2]+frame[3])==frame[4] &&
    temperature(frame)>=-40 && temperature(frame)<=80 && humidity(frame)<=100;
}
}
