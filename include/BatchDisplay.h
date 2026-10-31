#pragma once
#include <stdint.h>

namespace HatchDisplay {
// Motor 1 is lower (index 0); motor 2 is upper (index 1).
constexpr int predictionMotor(bool lower,bool upper,bool shared,uint32_t page) {
  return upper ? lower && !shared && (page&1) ? 0 : 1 : lower ? 0 : -1;
}
}
