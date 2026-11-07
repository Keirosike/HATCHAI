#pragma once
#include <stdint.h>

namespace HatchDisplay {
// Live metadata wins; otherwise use the newest CRC-valid matching SD label even
// before RTC-based recovery can run. Never substitute an opaque internal ID.
constexpr int labelSource(bool live,bool a,uint32_t sequenceA,bool b,uint32_t sequenceB) {
  return live ? -2 : b && (!a || sequenceB>sequenceA) ? 1 : a ? 0 : -1;
}
// Motor 1 is lower (index 0); motor 2 is upper (index 1).
constexpr int predictionMotor(bool lower,bool upper,bool shared,uint32_t page) {
  return upper ? lower && !shared && (page&1) ? 0 : 1 : lower ? 0 : -1;
}
}
