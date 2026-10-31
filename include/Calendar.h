#pragma once
#include <stdint.h>
#if __cplusplus >= 201402L
#define HATCH_CAL_CONSTEXPR constexpr
#else
#define HATCH_CAL_CONSTEXPR
#endif
namespace HatchCalendar {
constexpr bool leap(uint16_t y) { return y % 4 == 0 && (y % 100 != 0 || y % 400 == 0); }
constexpr uint8_t monthDays(uint16_t y, uint8_t m) {
  return m == 2 ? (leap(y) ? 29 : 28) :
    (m == 4 || m == 6 || m == 9 || m == 11 ? 30 : 31);
}
constexpr bool valid(uint16_t y, uint8_t m, uint8_t d, uint8_t h, uint8_t n, uint8_t s) {
  return y >= 2024 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 &&
    d <= monthDays(y, m) && h < 24 && n < 60 && s < 60;
}
inline HATCH_CAL_CONSTEXPR uint32_t epoch(uint16_t y, uint8_t m, uint8_t d,
                                uint8_t h = 0, uint8_t n = 0, uint8_t s = 0) {
  if (!valid(y, m, d, h, n, s)) return 0;
  uint32_t days = 0;
  for (uint16_t year = 1970; year < y; ++year) days += leap(year) ? 366 : 365;
  for (uint8_t month = 1; month < m; ++month) days += monthDays(y, month);
  return (days + d - 1) * 86400UL + h * 3600UL + n * 60UL + s;
}
constexpr bool validEpoch(uint32_t e) { return e >= 1704067200UL && e <= 4102444799UL; }
}
#undef HATCH_CAL_CONSTEXPR
