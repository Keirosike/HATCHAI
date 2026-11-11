#include "CameraEventStore.h"
#include "JsonBuilder.h"
#include "nvs.h"
#include <ArduinoJson.h>
#include <Preferences.h>
#include <WiFi.h>
#include <time.h>
namespace {
String stamp(uint32_t utc) {
  if (!utc)
    return "null";
  time_t value = utc;
  tm parts{};
  gmtime_r(&value, &parts);
  char text[25];
  strftime(text, sizeof(text), "%Y-%m-%dT%H:%M:%SZ", &parts);
  return HatchJson::quote(text);
}
void reply(WiFiClient &client, int code, const String &body) {
  client.printf(
      "HTTP/1.1 %d Camera\r\nContent-Type: application/json\r\nConnection: "
      "close\r\nCache-Control: no-store\r\nContent-Length: %u\r\n\r\n",
      code, unsigned(body.length()));
  client.print(body);
}
} // namespace
void CameraEventStore::begin() {
  completions_ = xQueueCreate(4, sizeof(Completion));
  TaskHandle_t handle = nullptr;
  if (!completions_ || xTaskCreatePinnedToCore(task, "camera-events", 10240,
                                               this, 1, &handle, 0) != pdPASS)
    fault_ = true;
}
void CameraEventStore::observeClock(uint32_t value) {
  clock_ = value;
  clockAt_ = millis();
}
uint32_t CameraEventStore::utc() const {
  const uint32_t elapsed = millis() - clockAt_.load(), value = clock_.load();
  return value >= 1704067200U && value < 4102444800U && elapsed < 10000
             ? value + elapsed / 1000
             : 0;
}
void CameraEventStore::task(void *self) {
  static_cast<CameraEventStore *>(self)->run();
}
bool CameraEventStore::active() const {
  portENTER_CRITICAL(&lock_);
  bool out = state_.count || views_[0].known || views_[1].known;
  portEXIT_CRITICAL(&lock_);
  return out;
}
bool CameraEventStore::peek(HatchCameraEvent::Event &event) const {
  if (!ready_)
    return false;
  bool found = false;
  portENTER_CRITICAL(&lock_);
  for (unsigned i = 0; i < state_.count; i++)
    if (state_.events[i].state == 0) {
      event = state_.events[i];
      found = true;
      break;
    }
  portEXIT_CRITICAL(&lock_);
  return found;
}
bool CameraEventStore::finish(const char *id, bool accepted) {
  if (!completions_ || !HatchCameraEvent::uuid(id))
    return false;
  Completion c{};
  memcpy(c.id, id, 37);
  c.accepted = accepted;
  return xQueueSend(completions_, &c, 0) == pdTRUE;
}
bool CameraEventStore::commit(const HatchCameraEvent::State &next) {
  Preferences p;
  if (!p.begin("hatchai-camev", false))
    return false;
  // Two complete CRC-protected snapshots; acknowledge only after both read
  // back.
  bool ok = true;
  HatchCameraEvent::State check;
  for (const char *name : {"a", "b"}) {
    if (p.putBytes(name, &next, sizeof(next)) != sizeof(next) ||
        p.getBytes(name, &check, sizeof(check)) != sizeof(check) ||
        memcmp(&check, &next, sizeof(next))) {
      ok = false;
      break;
    }
  }
  p.end();
  if (!ok) {
    fault_ = true;
    return false;
  }
  portENTER_CRITICAL(&lock_);
  memcpy(&state_, &next, sizeof(state_));
  portEXIT_CRITICAL(&lock_);
  fault_ = false;
  return true;
}
void CameraEventStore::snapshot(int8_t &upper, int8_t &lower, bool &upperChick,
                                bool &lowerChick) const {
  View v[2];
  portENTER_CRITICAL(&lock_);
  memcpy(v, views_, sizeof(v));
  portEXIT_CRITICAL(&lock_);
  const uint32_t now = millis();
  upper = !v[0].known ? -1 : uint32_t(now - v[0].seen) < 20000 ? 1 : 0;
  lower = !v[1].known ? -1 : uint32_t(now - v[1].seen) < 20000 ? 1 : 0;
  upperChick = upper == 1 && v[0].ok && v[0].chick;
  lowerChick = lower == 1 && v[1].ok && v[1].chick;
}
String CameraEventStore::statusJson() const {
  HatchCameraEvent::State state;
  View v[2];
  portENTER_CRITICAL(&lock_);
  state = state_;
  memcpy(v, views_, sizeof(v));
  portEXIT_CRITICAL(&lock_);
  String out = "{\"cameras\":[";
  const uint32_t now = millis();
  unsigned pending = 0, quarantined = 0;
  for (unsigned i = 0; i < 2; i++) {
    if (i)
      out += ",";
    const bool live = v[i].known && uint32_t(now - v[i].seen) < 20000;
    out += "{\"cameraId\":" + HatchJson::quote(HatchCameraEvent::Ids[i]) +
           ",\"position\":" + HatchJson::quote(i ? "lower" : "upper") +
           ",\"online\":" + HatchJson::boolValue(live) +
           ",\"detectorOk\":" + HatchJson::boolValue(live && v[i].ok) +
           ",\"chick\":" + HatchJson::boolValue(live && v[i].ok && v[i].chick) +
           ",\"url\":" +
           HatchJson::quote(live ? String("http://") + v[i].ip : String("")) +
           "}";
  }
  out += "],\"captures\":[";
  for (unsigned n = 0; n < state.count; n++) {
    const auto &e = state.events[state.count - 1 - n];
    if (n)
      out += ",";
    pending += e.state == 0;
    quarantined += e.state == 2;
    out += "{\"eventId\":" + HatchJson::quote(e.id) +
           ",\"position\":" + HatchJson::quote(e.camera ? "lower" : "upper") +
           ",\"capturedAt\":" + stamp(e.detectedAt) + ",\"timeSource\":" +
           HatchJson::quote(e.timeSource == 1   ? "camera-utc"
                            : e.timeSource == 2 ? "controller-rtc"
                                                : "unknown") +
           ",\"chick\":true,\"confirmed\":true,\"synchronized\":" +
           HatchJson::boolValue(e.state == 1) + "}";
  }
  out += "],\"persistentQueue\":{\"ready\":" + HatchJson::boolValue(ready_) +
         ",\"fault\":" + HatchJson::boolValue(fault_) +
         ",\"pending\":" + String(pending) +
         ",\"quarantined\":" + String(quarantined) +
         ",\"capacity\":" + String(HatchCameraEvent::Capacity) + "}}";
  return out;
}
void CameraEventStore::run() {
  HatchCameraEvent::State a{}, b{};
  bool va = false, vb = false, existing = false;
  nvs_handle_t handle;
  const auto opened = nvs_open("hatchai-camev", NVS_READONLY, &handle);
  if (opened == ESP_OK) {
    size_t na = sizeof(a), nb = sizeof(b);
    const auto ra = nvs_get_blob(handle, "a", &a, &na),
               rb = nvs_get_blob(handle, "b", &b, &nb);
    existing = ra != ESP_ERR_NVS_NOT_FOUND || rb != ESP_ERR_NVS_NOT_FOUND;
    va = ra == ESP_OK && na == sizeof(a) && a.valid();
    vb = rb == ESP_OK && nb == sizeof(b) && b.valid();
    nvs_close(handle);
  } else if (opened != ESP_ERR_NVS_NOT_FOUND)
    existing = true;
  if (va || vb) {
    const auto &selected = va && (!vb || a.generation >= b.generation) ? a : b;
    portENTER_CRITICAL(&lock_);
    state_ = selected;
    portEXIT_CRITICAL(&lock_);
    ready_ = true;
  } else if (existing)
    fault_ = true;
  else {
    HatchCameraEvent::State fresh{};
    fresh.seal();
    ready_ = commit(fresh);
  }
  while (WiFi.softAPIP() == IPAddress(0, 0, 0, 0))
    vTaskDelay(pdMS_TO_TICKS(100));
  WiFiServer server(WiFi.softAPIP(), 8081, 2);
  server.begin();
  for (;;) {
    Completion completion;
    while (completions_ &&
           xQueueReceive(completions_, &completion, 0) == pdTRUE) {
      HatchCameraEvent::State next;
      portENTER_CRITICAL(&lock_);
      next = state_;
      portEXIT_CRITICAL(&lock_);
      if (HatchCameraEvent::finish(next, completion.id, completion.accepted))
        commit(next);
    }
    WiFiClient client = server.available();
    if (!client) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    client.setTimeout(250);
    const IPAddress remote = client.remoteIP(), ap = WiFi.softAPIP();
    if (remote[0] != ap[0] || remote[1] != ap[1] || remote[2] != ap[2] ||
        remote == ap) {
      reply(client, 403, "{}");
      client.stop();
      continue;
    }
    String header;
    header.reserve(512);
    const uint32_t start = millis();
    while (client.connected() && header.length() < 512 &&
           !header.endsWith("\r\n\r\n") && uint32_t(millis() - start) < 1000) {
      if (client.available())
        header += char(client.read());
      else
        vTaskDelay(pdMS_TO_TICKS(1));
    }
    String lower = header;
    lower.toLowerCase();
    const int at = lower.indexOf("\r\ncontent-length:");
    const int end = at < 0 ? -1 : lower.indexOf("\r\n", at + 2);
    const int length = at < 0 ? 0 : lower.substring(at + 17, end).toInt();
    if (!header.startsWith("POST /events HTTP/1.1\r\n") ||
        !header.endsWith("\r\n\r\n") || at < 0 ||
        lower.indexOf("\r\ncontent-length:", at + 2) >= 0 ||
        lower.indexOf("transfer-encoding:") >= 0 ||
        lower.indexOf("content-type: application/json") < 0 || length <= 0 ||
        length > 768) {
      reply(client, 400, "{}");
      client.stop();
      continue;
    }
    char body[769];
    const size_t got = client.readBytes(body, length);
    body[got] = 0;
    StaticJsonDocument<1024> doc;
    if (got != size_t(length) || deserializeJson(doc, body, got) ||
        doc["v"] != 2 || !doc["mac"].is<const char *>() ||
        !doc["detectorOk"].is<bool>() || !doc["chick"].is<bool>()) {
      reply(client, 400, "{}");
      client.stop();
      continue;
    }
    const int camera = HatchCameraEvent::placement(doc["mac"]);
    if (camera < 0) {
      reply(client, 403, "{}");
      client.stop();
      continue;
    }
    View view{};
    strlcpy(view.ip, remote.toString().c_str(), sizeof(view.ip));
    view.known = true;
    view.seen = millis();
    view.ok = doc["detectorOk"];
    view.chick = doc["chick"];
    portENTER_CRITICAL(&lock_);
    views_[camera] = view;
    portEXIT_CRITICAL(&lock_);
    String response = "{\"ok\":true,\"utc\":" + String(utc());
    int status = 200;
    if (!doc["event"].isNull()) {
      const auto item = doc["event"].as<JsonObjectConst>();
      HatchCameraEvent::Event event{};
      const char *id = item["eventId"] | "";
      strlcpy(event.id, id, sizeof(event.id));
      event.camera = camera;
      event.incarnation = item["incarnation"] | 0U;
      event.sequence = item["sequence"] | 0U;
      event.confidence = item["confidence"] | 0;
      event.detectedAt = item["detectedAt"] | 0U;
      event.receivedAt = utc();
      event.timeSource = event.detectedAt ? 1 : 0;
      if (!event.detectedAt && event.receivedAt &&
          item["ageMs"].is<uint32_t>()) {
        const uint32_t age = item["ageMs"].as<uint32_t>() / 1000;
        if (age < event.receivedAt - 1704067200U) {
          event.detectedAt = event.receivedAt - age;
          event.timeSource = 2;
        }
      }
      if (strlen(id) != 36 || !item["confidence"].is<uint16_t>() ||
          item["confirmed"] != true || !HatchCameraEvent::valid(event) ||
          (event.receivedAt && event.detectedAt > event.receivedAt + 60)) {
        status = 400;
      } else if (!ready_) {
        status = 503;
      } else {
        HatchCameraEvent::State next;
        portENTER_CRITICAL(&lock_);
        next = state_;
        portEXIT_CRITICAL(&lock_);
        const auto result = HatchCameraEvent::add(next, event);
        if (result == HatchCameraEvent::Admission::Invalid)
          status = 400;
        else if (result == HatchCameraEvent::Admission::Full)
          status = 503;
        else if (result == HatchCameraEvent::Admission::Added && !commit(next))
          status = 503;
        if (status == 200) {
          response +=
              ",\"accepted\":true,\"eventId\":" + HatchJson::quote(event.id);
          if (result == HatchCameraEvent::Admission::Added) {
            added_++;
            alertPending_ = true;
          }
        }
      }
    }
    if (status != 200)
      rejected_++;
    response += "}";
    reply(client, status, response);
    client.stop();
  }
}
