#include "camera_local.hpp"
#include "CameraEventClock.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <cstdio>
#include <cstring>
#include <initializer_list>
#include <memory>
#include <new>
#include <stddef.h>
namespace HatchCameraLocal {
namespace {
struct Journal {
  uint32_t magic = 0x48434a32, version = 1, generation = 0, incarnation = 0,
           sequence = 0;
  uint8_t latched = 0, reserved[3]{};
  HatchCameraEvent::State queue{};
  uint32_t checksum = 0;
  void seal() {
    queue.seal();
    checksum = HatchCameraEvent::crc(this, offsetof(Journal, checksum));
  }
  bool valid() const {
    return magic == 0x48434a32 && version == 1 && incarnation && latched <= 1 &&
           queue.valid() &&
           checksum == HatchCameraEvent::crc(this, offsetof(Journal, checksum));
  }
};
Journal saved;
HatchCameraEvent::Episode episode;
SemaphoreHandle_t mutex;
char address[13]{};
int role = -1;
bool ready = false, blocked = false;
uint32_t bootId = 0, clockUtc = 0;
uint64_t clockMs = 0;
uint64_t now() { return uint64_t(esp_timer_get_time() / 1000); }
bool commit(Journal &next) {
  std::unique_ptr<Journal> readback(new (std::nothrow) Journal);
  if (!readback)
    return false;
  Journal &check = *readback;
  if (next.generation == UINT32_MAX)
    return false;
  next.generation++;
  next.seal();
  nvs_handle_t p;
  if (nvs_open("hatchai-episode", NVS_READWRITE, &p) != ESP_OK)
    return false;
  bool ok = true;
  for (const char *name : {"a", "b"}) {
    size_t n = sizeof(check);
    if (nvs_set_blob(p, name, &next, sizeof(next)) != ESP_OK ||
        nvs_commit(p) != ESP_OK ||
        nvs_get_blob(p, name, &check, &n) != ESP_OK || n != sizeof(check) ||
        memcmp(&check, &next, n)) {
      ok = false;
      break;
    }
  }
  nvs_close(p);
  if (ok) {
    memcpy(&saved, &next, sizeof(saved));
    blocked = false;
  } else
    blocked = true;
  return ok;
}
void guid(char out[37]) {
  uint8_t b[16];
  esp_fill_random(b, sizeof(b));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  snprintf(
      out, 37,
      "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
      b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11],
      b[12], b[13], b[14], b[15]);
}
} // namespace
void begin(uint32_t boot) {
  bootId = boot;
  mutex = xSemaphoreCreateMutex();
  if (!mutex)
    return;
  uint8_t bytes[6];
  if (esp_read_mac(bytes, ESP_MAC_WIFI_STA) != ESP_OK)
    return;
  snprintf(address, sizeof(address), "%02x%02x%02x%02x%02x%02x", bytes[0],
           bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  role = HatchCameraEvent::placement(address);
  if (role < 0) {
    ESP_LOGE("CAMERA_LOCAL",
             "Unknown MAC: placement unavailable; inference remains active");
    return;
  }
  nvs_handle_t config;
  if (nvs_open("hatchai-camera", NVS_READWRITE, &config) != ESP_OK)
    return;
  char storedMac[13]{};
  size_t n = sizeof(storedMac);
  uint8_t storedRole = 255;
  const auto macResult = nvs_get_str(config, "mac", storedMac, &n);
  const bool existing = macResult == ESP_OK;
  const auto roleResult = nvs_get_u8(config, "placement", &storedRole);
  if ((macResult != ESP_OK && macResult != ESP_ERR_NVS_NOT_FOUND) ||
      (roleResult != ESP_OK && roleResult != ESP_ERR_NVS_NOT_FOUND)) {
    nvs_close(config);
    return;
  }
  if (existing && (strcmp(storedMac, address) ||
                   (roleResult == ESP_OK && storedRole != role))) {
    nvs_close(config);
    ESP_LOGE("CAMERA_LOCAL",
             "Stored placement does not match this board; no NVS replacement");
    return;
  }
  const bool assigned = nvs_set_str(config, "mac", address) == ESP_OK &&
                        nvs_set_u8(config, "placement", role) == ESP_OK &&
                        nvs_commit(config) == ESP_OK;
  nvs_close(config);
  if (!assigned)
    return;
  std::unique_ptr<Journal> first(new (std::nothrow) Journal),
      second(new (std::nothrow) Journal);
  if (!first || !second)
    return;
  Journal &a = *first;
  Journal &b = *second;
  bool va = false, vb = false, exists = false;
  nvs_handle_t p;
  const auto opened = nvs_open("hatchai-episode", NVS_READONLY, &p);
  if (opened != ESP_OK && opened != ESP_ERR_NVS_NOT_FOUND) {
    ESP_LOGE("CAMERA_LOCAL",
             "Cannot inspect existing event journal; no replacement");
    return;
  }
  if (opened == ESP_OK) {
    size_t na = sizeof(a), nb = sizeof(b);
    const auto ra = nvs_get_blob(p, "a", &a, &na),
               rb = nvs_get_blob(p, "b", &b, &nb);
    exists = ra != ESP_ERR_NVS_NOT_FOUND || rb != ESP_ERR_NVS_NOT_FOUND;
    va = ra == ESP_OK && na == sizeof(a) && a.valid();
    vb = rb == ESP_OK && nb == sizeof(b) && b.valid();
    nvs_close(p);
  }
  if (va || vb) {
    saved = va && (!vb || a.generation >= b.generation) ? a : b;
    ready = true;
  } else if (!exists) {
    std::unique_ptr<Journal> initial(new (std::nothrow) Journal);
    if (!initial)
      return;
    do {
      initial->incarnation = esp_random();
    } while (!initial->incarnation);
    ready = commit(*initial);
  }
  episode.latched = saved.latched;
  ESP_LOGI("CAMERA_LOCAL", "Placement %s; durable events %s",
           role ? "Lower" : "Upper", ready ? "ready" : "unavailable");
}
const char *mac() { return address; }
int position() { return role; }
const char *id() { return role >= 0 ? HatchCameraEvent::Ids[role] : ""; }
bool healthy() {
  if (!mutex)
    return false;
  xSemaphoreTake(mutex, portMAX_DELAY);
  bool ok = ready && !blocked;
  xSemaphoreGive(mutex);
  return ok;
}
bool confirmed() {
  if (!mutex)
    return false;
  xSemaphoreTake(mutex, portMAX_DELAY);
  bool out = episode.latched;
  xSemaphoreGive(mutex);
  return out;
}
void synchronize(uint32_t utc) {
  if (!mutex)
    return;
  xSemaphoreTake(mutex, portMAX_DELAY);
  clockUtc = utc >= 1704067200U && utc < 4102444800U ? utc : 0;
  clockMs = now();
  xSemaphoreGive(mutex);
}
bool observe(bool ok, bool chick, uint16_t confidence, uint64_t captured) {
  if (!mutex)
    return false;
  xSemaphoreTake(mutex, portMAX_DELAY);
  const auto before = episode;
  const bool fresh = episode.sample(ok, chick);
  bool emitted = false;
  if (ready && (fresh || episode.latched != bool(saved.latched))) {
    Journal next = saved;
    next.latched = episode.latched;
    bool valid = true;
    if (fresh) {
      HatchCameraEvent::Event event{};
      guid(event.id);
      event.camera = role;
      event.incarnation = saved.incarnation;
      event.sequence = saved.sequence + 1;
      event.confidence = confidence;
      event.capturedBoot = bootId;
      event.capturedMs = captured;
      event.detectedAt =
          HatchCameraClock::utcAt(clockUtc, clockMs, captured, now());
      if (event.detectedAt)
        event.timeSource = 1;
      valid = saved.sequence < UINT32_MAX &&
              HatchCameraEvent::add(next.queue, event) ==
                  HatchCameraEvent::Admission::Added;
      next.sequence = event.sequence;
    }
    if (valid && commit(next))
      emitted = fresh;
    else {
      blocked = true;
      episode = before;
      ESP_LOGW("CAMERA_LOCAL",
               "Durable episode queue unavailable/full; retain pending events");
    }
  }
  xSemaphoreGive(mutex);
  return emitted;
}
bool pending(HatchCameraEvent::Event &event, uint32_t &age, bool &known) {
  if (!ready || !mutex)
    return false;
  bool found = false;
  xSemaphoreTake(mutex, portMAX_DELAY);
  for (unsigned i = 0; i < saved.queue.count; i++)
    if (saved.queue.events[i].state == 0) {
      event = saved.queue.events[i];
      known = HatchCameraClock::age(bootId, event.capturedBoot, now(),
                                    event.capturedMs, age);
      found = true;
      break;
    }
  xSemaphoreGive(mutex);
  return found;
}
bool acknowledge(const char *id) {
  if (!ready || !mutex)
    return false;
  xSemaphoreTake(mutex, portMAX_DELAY);
  Journal next = saved;
  const bool ok =
      HatchCameraEvent::finish(next.queue, id, true) && commit(next);
  xSemaphoreGive(mutex);
  return ok;
}
} // namespace HatchCameraLocal
