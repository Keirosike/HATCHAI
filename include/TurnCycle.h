#pragma once

#include <stdint.h>

// One independent, non-blocking motor timer. Unsigned subtraction handles rollover.
struct TurnCycle {
  bool hasTurned;
  bool active;
  uint32_t lastTurnMs;
  uint32_t pulseStartedMs;
  uint32_t pulseDurationMs;

  constexpr TurnCycle(bool turned = false, bool running = false,
                      uint32_t lastMs = 0, uint32_t pulseMs = 0, uint32_t durationMs = 0)
    : hasTurned(turned), active(running), lastTurnMs(lastMs), pulseStartedMs(pulseMs),
      pulseDurationMs(durationMs) {}

  bool start(uint32_t nowMs, uint32_t durationMs = 0) {
    if (active) return false;
    active = true;
    hasTurned = true;
    lastTurnMs = nowMs;
    pulseStartedMs = nowMs;
    pulseDurationMs = durationMs;
    return true;
  }

  bool finishIfDue(uint32_t nowMs, uint32_t pulseMs) {
    if (!pulseExpired(nowMs, pulseMs)) return false;
    active = false;
    return true;
  }

  constexpr bool pulseExpired(uint32_t nowMs, uint32_t pulseMs) const {
    return active && uint32_t(nowMs - pulseStartedMs) >= pulseMs;
  }

  constexpr uint32_t pulseRemainingMs(uint32_t nowMs) const {
    return !active || pulseExpired(nowMs, pulseDurationMs)
      ? 0 : pulseDurationMs - uint32_t(nowMs - pulseStartedMs);
  }

  constexpr uint32_t elapsedMs(uint32_t nowMs, uint32_t bootMs) const {
    return nowMs - (hasTurned ? lastTurnMs : bootMs);
  }

  constexpr uint32_t remainingMs(uint32_t nowMs, uint32_t bootMs, uint32_t intervalMs) const {
    return elapsedMs(nowMs, bootMs) >= intervalMs ? 0 : intervalMs - elapsedMs(nowMs, bootMs);
  }

  constexpr bool isDue(uint32_t nowMs, uint32_t bootMs, uint32_t intervalMs) const {
    return !active && remainingMs(nowMs, bootMs, intervalMs) == 0;
  }
};
