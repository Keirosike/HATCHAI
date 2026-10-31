#pragma once
#include <stdint.h>
#include <stddef.h>

namespace HatchSht40 {
constexpr uint8_t MeasureHighPrecision=0xfd;
#if __cplusplus >= 201402L
constexpr
#else
inline
#endif
uint8_t crc(const uint8_t* data,size_t size) {
  uint8_t value=0xff;
  for(size_t i=0;i<size;++i) {
    value^=data[i];
    for(uint8_t bit=0;bit<8;++bit) value=value&0x80 ? uint8_t((value<<1)^0x31) : uint8_t(value<<1);
  }
  return value;
}
#if __cplusplus >= 201402L
constexpr
#else
inline
#endif
bool validFrame(const uint8_t* bytes,size_t size) {
  return size==6 && crc(bytes,2)==bytes[2] && crc(bytes+3,2)==bytes[5];
}
constexpr float temperature(uint16_t ticks) { return -45.0f+175.0f*ticks/65535.0f; }
constexpr float rawHumidity(uint16_t ticks) { return -6.0f+125.0f*ticks/65535.0f; }
constexpr float humidity(uint16_t ticks) {
  return rawHumidity(ticks)<0 ? 0 : rawHumidity(ticks)>100 ? 100 : rawHumidity(ticks);
}
}
