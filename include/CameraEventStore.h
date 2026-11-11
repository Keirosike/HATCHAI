#pragma once
#include "CameraEventProtocol.h"
#include <Arduino.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
class CameraEventStore {
public:
  bool takeAlert() { return alertPending_.exchange(false); }
  void begin();
  void observeClock(uint32_t utc);
  bool active() const;
  bool peek(HatchCameraEvent::Event &event) const;
  bool finish(const char *id, bool accepted);
  String statusJson() const;
  void snapshot(int8_t &upper, int8_t &lower, bool &upperChick,
                bool &lowerChick) const;
  uint32_t utc() const;

private:
  struct View {
    char ip[16]{};
    uint32_t seen = 0;
    bool known = false, ok = false, chick = false;
  };
  struct Completion {
    char id[37];
    bool accepted;
  };
  static void task(void *);
  void run();
  bool commit(const HatchCameraEvent::State &);
  mutable portMUX_TYPE lock_ = portMUX_INITIALIZER_UNLOCKED;
  HatchCameraEvent::State state_{};
  View views_[2]{};
  std::atomic<bool> ready_{false}, fault_{false}, alertPending_{false};
  std::atomic<uint32_t> clock_{0}, clockAt_{0};
  std::atomic<uint32_t> added_{0}, rejected_{0};
  QueueHandle_t completions_ = nullptr;
};
