#pragma once
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
namespace HatchCameraEvent {
constexpr unsigned Capacity = 16;
constexpr const char *Ids[] = {"hatchai-inc01-cam01", "hatchai-inc01-cam02"};
constexpr const char *Macs[] = {"d885accba598", "d885acca0c00"};
inline int placement(const char *mac) {
  for (unsigned i = 0; i < 2; i++)
    if (mac && strcmp(mac, Macs[i]) == 0)
      return int(i);
  return -1;
}
inline bool uuid(const char *id) {
  if (!id || strlen(id) != 36)
    return false;
  for (unsigned i = 0; i < 36; i++) {
    const char c = id[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-')
        return false;
    } else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
      return false;
  }
  return id[14] == '4' &&
         (id[19] == '8' || id[19] == '9' || id[19] == 'a' || id[19] == 'b');
}
inline uint32_t crc(const void *bytes, size_t n) {
  uint32_t out = ~0U;
  auto p = static_cast<const uint8_t *>(bytes);
  while (n--) {
    out ^= *p++;
    for (unsigned i = 0; i < 8; i++)
      out = (out >> 1) ^ (0xedb88320U & (0U - (out & 1)));
  }
  return ~out;
}
struct Event {
  char id[37]{};
  uint8_t camera = 0, state = 0,
          timeSource = 0; // state: pending/acknowledged/quarantined
  uint32_t incarnation = 0, sequence = 0, detectedAt = 0, receivedAt = 0,
           capturedMs = 0, capturedBoot = 0;
  uint16_t confidence = 0, reserved = 0;
};
inline bool valid(const Event &e) {
  return uuid(e.id) && e.camera < 2 && e.state <= 2 && e.incarnation &&
         e.sequence && e.confidence >= 500 && e.confidence <= 1000 &&
         e.timeSource <= 2 && (!e.detectedAt || e.detectedAt >= 1704067200U) &&
         (!e.receivedAt || e.receivedAt >= 1704067200U);
}
struct Cursor {
  uint32_t incarnation = 0, sequence = 0;
  char id[37]{};
};
struct State {
  uint32_t magic = 0x48434532, version = 1, generation = 0;
  uint8_t count = 0, reserved[3]{};
  Cursor cursors[2]{};
  Event events[Capacity]{};
  uint32_t checksum = 0;
  void seal() { checksum = crc(this, offsetof(State, checksum)); }
  bool valid() const {
    if (magic != 0x48434532 || version != 1 || count > Capacity ||
        checksum != crc(this, offsetof(State, checksum)))
      return false;
    for (unsigned i = 0; i < count; i++)
      if (!HatchCameraEvent::valid(events[i]))
        return false;
    return true;
  }
};
enum class Admission { Added, Duplicate, Full, Invalid };
inline Admission add(State &s, const Event &event) {
  if (!valid(event) || event.state)
    return Admission::Invalid;
  for (unsigned i = 0; i < s.count; i++)
    if (strcmp(s.events[i].id, event.id) == 0)
      return memcmp(&s.events[i].camera, &event.camera, 1) == 0
                 ? Admission::Duplicate
                 : Admission::Invalid;
  const Cursor &old = s.cursors[event.camera];
  if (old.incarnation == event.incarnation && event.sequence <= old.sequence)
    return Admission::Duplicate;
  if (s.generation == UINT32_MAX)
    return Admission::Full;
  if (s.count == Capacity) {
    unsigned retired = 0;
    while (retired < s.count && s.events[retired].state != 1)
      retired++;
    if (retired == s.count)
      return Admission::Full;
    for (unsigned i = retired + 1; i < s.count; i++)
      s.events[i - 1] = s.events[i];
    s.count--;
  }
  s.events[s.count++] = event;
  auto &cursor = s.cursors[event.camera];
  cursor.incarnation = event.incarnation;
  cursor.sequence = event.sequence;
  memcpy(cursor.id, event.id, 37);
  s.generation++;
  s.seal();
  return Admission::Added;
}
inline bool finish(State &s, const char *id, bool accepted) {
  for (unsigned i = 0; i < s.count; i++)
    if (strcmp(s.events[i].id, id) == 0) {
      if (s.events[i].state)
        return true;
      if (s.generation == UINT32_MAX)
        return false;
      s.events[i].state = accepted ? 1 : 2;
      s.generation++;
      s.seal();
      return true;
    }
  return false;
}
// Three valid positive frames confirm one episode. Five valid negatives rearm
// it. Detector errors neither confirm nor rearm. Latched must be persisted by
// the caller.
struct Episode {
  unsigned hits = 0, misses = 0;
  bool latched = false;
  bool sample(bool ok, bool chick) {
    if (!ok) {
      hits = misses = 0;
      return false;
    }
    if (chick) {
      misses = 0;
      if (hits < 3)
        hits++;
      if (hits == 3 && !latched) {
        latched = true;
        return true;
      }
    } else {
      hits = 0;
      if (misses < 5)
        misses++;
      if (misses == 5)
        latched = false;
    }
    return false;
  }
};
} // namespace HatchCameraEvent
