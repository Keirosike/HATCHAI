#pragma once
#include "Calendar.h"
#include "Config.h"
namespace HatchTurning {
constexpr bool ageAllowed(uint32_t now, uint32_t start, uint32_t reserved, uint32_t turningEnd=0) {
  return HatchCalendar::validEpoch(now) && HatchCalendar::validEpoch(start) &&
    reserved >= start && now >= reserved && now < (turningEnd ? turningEnd : start+HatchConfig::LockdownAfterSeconds);
}
constexpr bool due(uint32_t now, uint32_t start, uint32_t reserved, uint16_t minutes) {
  return ageAllowed(now, start, reserved) && minutes >= 30 && minutes <= 360 &&
    now - reserved >= minutes * 60UL;
}
constexpr bool canStart(bool motorOn, uint32_t nowMs, uint32_t offMs) {
  return !motorOn && uint32_t(nowMs - offMs) >= HatchConfig::MotorGapMs;
}
}
