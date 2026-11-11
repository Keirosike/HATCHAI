#pragma once

#include <Arduino.h>
#include <math.h>

namespace HatchJson {

// Keep one copy of JSON formatting helpers when LTO would duplicate them
// at many dashboard/API call sites. Formatting and allocation behavior are unchanged.

__attribute__((noinline)) inline String escape(const String& value) {
  String escaped;
  escaped.reserve(value.length() + 8);

  for (size_t i = 0; i < value.length(); i++) {
    const char c = value[i];

    if (c == '"') {
      escaped += "\\\"";
    } else if (c == '\\') {
      escaped += "\\\\";
    } else if (c == '\n') {
      escaped += "\\n";
    } else if (c == '\r') {
      escaped += "\\r";
    } else if (c == '\t') {
      escaped += "\\t";
    } else if (c >= 0 && c < 0x20) {
      continue;
    } else {
      escaped += c;
    }
  }

  return escaped;
}

__attribute__((noinline)) inline String quote(const String& value) {
  return String("\"") + escape(value) + "\"";
}

__attribute__((noinline)) inline String boolValue(bool value) {
  return value ? "true" : "false";
}

__attribute__((noinline)) inline String number(float value, unsigned int decimals = 1) {
  if (isnan(value) || isinf(value)) {
    return "null";
  }

  return String(value, decimals);
}

}
