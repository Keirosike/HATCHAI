#pragma once

#include <Arduino.h>
#include "IncubatorTypes.h"

class ReadingHistory {
public:
  void add(const SensorReading& reading);
  String toJson() const;

private:
  struct HistoryPoint {
    float temperatureC = NAN;
    float humidityPercent = NAN;
    uint32_t timestampMs = 0;
  };

  static constexpr size_t Capacity = 96;

  HistoryPoint pointAt(size_t logicalIndex) const;
  void appendWindow(String& json, const char* name, size_t maxPoints) const;
  String labelFor(uint32_t timestampMs, uint32_t nowMs) const;

  HistoryPoint _points[Capacity];
  size_t _nextIndex = 0;
  size_t _count = 0;
};
