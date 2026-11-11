
#include "cJSON.h"
#include "camera_local.hpp"
#include "esp_camera.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_sntp.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "hatch_link_config.hpp"
#include "mobilenet_detector.hpp"
#include "nvs.h"
#include "nvs_flash.h"
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <stdio.h>
#include <string>

#include "dl_image_jpeg.hpp"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include <time.h>

static const char *TAG = "HATCHAI_CAMERA";
struct DetectionJob {
  uint8_t *data;
  size_t length;
  int64_t captured;
};
static QueueHandle_t detection_queue;
static SemaphoreHandle_t detection_slot;
static SemaphoreHandle_t result_mutex;
static std::string latest_boxes = "[]";
static std::string latest_status = "Waiting for first inference";
static int64_t latest_captured = 0;
static int64_t latest_inference_ms = 0;
static float requested_confidence = 0.5f;
static bool detector_ok = false;
static bool chick_present = false;
static uint32_t boot_id = 0;
static esp_timer_handle_t wifi_retry_timer;

struct LocalResponse {
  char bytes[256]{};
  size_t size = 0;
  bool overflow = false;
};
static esp_err_t local_response(esp_http_client_event_t *event) {
  if (event->event_id == HTTP_EVENT_ON_DATA) {
    auto r = static_cast<LocalResponse *>(event->user_data);
    if (r->size + event->data_len >= sizeof(r->bytes)) {
      r->overflow = true;
      return ESP_FAIL;
    }
    memcpy(r->bytes + r->size, event->data, event->data_len);
    r->size += event->data_len;
    r->bytes[r->size] = 0;
  }
  return ESP_OK;
}
static bool post_local(const char *url, const char *body, const char *pending) {
  LocalResponse response;
  esp_http_client_config_t config{};
  config.url = url;
  config.timeout_ms = 1200;
  config.disable_auto_redirect = true;
  config.event_handler = local_response;
  config.user_data = &response;
  config.buffer_size = 384;
  auto client = esp_http_client_init(&config);
  if (!client)
    return false;
  esp_http_client_set_method(client, HTTP_METHOD_POST);
  esp_http_client_set_header(client, "Content-Type", "application/json");
  esp_http_client_set_post_field(client, body, strlen(body));
  const auto result = esp_http_client_perform(client);
  const int code = esp_http_client_get_status_code(client);
  esp_http_client_cleanup(client);
  if (result != ESP_OK || code != 200 || response.overflow)
    return false;
  cJSON *answer = cJSON_Parse(response.bytes);
  if (!answer)
    return false;
  const auto utc = cJSON_GetObjectItemCaseSensitive(answer, "utc");
  if (cJSON_IsNumber(utc) && utc->valuedouble >= 0 &&
      utc->valuedouble < 4102444800.0)
    HatchCameraLocal::synchronize(uint32_t(utc->valuedouble));
  const auto accepted = cJSON_GetObjectItemCaseSensitive(answer, "accepted"),
             id = cJSON_GetObjectItemCaseSensitive(answer, "eventId");
  const bool ack = pending && cJSON_IsTrue(accepted) && cJSON_IsString(id) &&
                   !strcmp(id->valuestring, pending);
  cJSON_Delete(answer);
  return !pending || (ack && HatchCameraLocal::acknowledge(pending));
}
static void link_task(void *) {
  uint32_t next = 0;
  unsigned failures = 0;
  for (;;) {
    esp_netif_ip_info_t ip{};
    auto netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    if (!netif || esp_netif_get_ip_info(netif, &ip) != ESP_OK || !ip.ip.addr ||
        !ip.gw.addr) {
      next = uint32_t(esp_timer_get_time() / 1000);
      failures = 0;
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }
    const uint32_t now = uint32_t(esp_timer_get_time() / 1000);
    HatchCameraEvent::Event event;
    uint32_t age = 0;
    bool ageKnown = false;
    const bool pending = HatchCameraLocal::pending(event, age, ageKnown) &&
                         int32_t(now - next) >= 0;
    char gateway[20], url[80], body[720], eventJson[400];
    snprintf(gateway, sizeof(gateway), IPSTR, IP2STR(&ip.gw));
    snprintf(url, sizeof(url), "http://%s:8081/events", gateway);
    xSemaphoreTake(result_mutex, portMAX_DELAY);
    const bool ok = detector_ok && latest_captured &&
                    esp_timer_get_time() - latest_captured < 30000000;
    const bool present = ok && chick_present;
    xSemaphoreGive(result_mutex);
    if (pending) {
      char detected[16], elapsed[16];
      snprintf(detected, sizeof(detected), "%lu",
               (unsigned long)event.detectedAt);
      snprintf(elapsed, sizeof(elapsed), "%lu", (unsigned long)age);
      snprintf(eventJson, sizeof(eventJson),
               "{\"eventId\":\"%s\",\"incarnation\":%lu,\"sequence\":%lu,"
               "\"detectedAt\":%s,\"ageMs\":%s,\"confirmed\":true,"
               "\"confidence\":%u}",
               event.id, (unsigned long)event.incarnation,
               (unsigned long)event.sequence,
               event.detectedAt ? detected : "null",
               ageKnown ? elapsed : "null", unsigned(event.confidence));
    }
    snprintf(
        body, sizeof(body),
        "{\"v\":2,\"mac\":\"%s\",\"detectorOk\":%s,\"chick\":%s,\"event\":%s}",
        HatchCameraLocal::mac(), ok ? "true" : "false",
        present ? "true" : "false", pending ? eventJson : "null");
    const bool delivered = post_local(url, body, pending ? event.id : nullptr);
    if (pending) {
      if (delivered) {
        failures = 0;
        next = now + 1000;
      } else {
        failures = failures < 5 ? failures + 1 : 5;
        next = now + (1000U << failures) + (esp_random() % 500);
      }
    }
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}
static void capture_task(void *) {
  while (true) {
    if (xSemaphoreTake(detection_slot, pdMS_TO_TICKS(1000)) != pdTRUE)
      continue;
    camera_fb_t *frame = esp_camera_fb_get();
    bool queued = false;
    if (frame) {
      auto *copy = static_cast<uint8_t *>(
          heap_caps_malloc(frame->len, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
      if (copy) {
        memcpy(copy, frame->buf, frame->len);
        DetectionJob job = {copy, frame->len, esp_timer_get_time()};
        queued = xQueueSend(detection_queue, &job, 0) == pdTRUE;
        if (!queued)
          heap_caps_free(copy);
      }
      esp_camera_fb_return(frame);
    }
    if (!queued)
      xSemaphoreGive(detection_slot);
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}
static void retry_wifi(void *) { esp_wifi_connect(); }
static void wifi_event(void *, esp_event_base_t base, int32_t id, void *) {
  if (base != WIFI_EVENT)
    return;
  if (id == WIFI_EVENT_STA_START)
    esp_wifi_connect();
  if (id == WIFI_EVENT_STA_DISCONNECTED) {
    // Avoid continuous station scans disrupting the camera's setup hotspot.
    esp_timer_stop(wifi_retry_timer);
    esp_timer_start_once(wifi_retry_timer, 5000000);
  }
  if (id == WIFI_EVENT_STA_CONNECTED)
    esp_timer_stop(wifi_retry_timer);
}

static bool run_detection(camera_fb_t *frame, float confidence,
                          std::string &boxes, std::string &status) {
  dl::image::jpeg_img_t jpeg = {
      .data = frame->buf,
      .data_len = frame->len,
  };
  auto image =
      dl::image::sw_decode_jpeg(jpeg, dl::image::DL_IMAGE_PIX_TYPE_RGB888);
  if (image.data == NULL) {
    ESP_LOGW(TAG, "Could not decode JPEG for detection");
    status = "JPEG decoding failed";
    return false;
  }
  bool success =
      mobilenet_detect(static_cast<const uint8_t *>(image.data), image.width,
                       image.height, confidence, boxes, status);
  heap_caps_free(image.data);
  return success;
}

static void detection_task(void *) {
  if (!mobilenet_init()) {
    ESP_LOGE(TAG, "MobileNetV2 initialization failed: insufficient memory");
    xSemaphoreTake(result_mutex, portMAX_DELAY);
    latest_status = "MobileNetV2 initialization failed";
    xSemaphoreGive(result_mutex);
    vTaskDelete(nullptr);
    return;
  }
  // No camera cloud task: all events go through the controller AP.
  ESP_LOGI(
      TAG,
      "MobileNetV2 INT8 local classification active; internet is not required");
  xSemaphoreGive(detection_slot);
  DetectionJob job;
  while (true) {
    if (xQueueReceive(detection_queue, &job, portMAX_DELAY) != pdTRUE)
      continue;
    camera_fb_t frame = {};
    frame.buf = job.data;
    frame.len = job.length;
    std::string boxes, status;
    xSemaphoreTake(result_mutex, portMAX_DELAY);
    float confidence = requested_confidence;
    xSemaphoreGive(result_mutex);
    int64_t started = esp_timer_get_time();
    bool success = run_detection(&frame, confidence, boxes, status);
    const bool positive = success && boxes != "[]";
    HatchCameraLocal::observe(success, positive, mobilenet_confidence(),
                              uint64_t(job.captured / 1000));
    xSemaphoreTake(result_mutex, portMAX_DELAY);
    latest_boxes = success ? boxes : "[]";
    detector_ok = success;
    chick_present = success && HatchCameraLocal::confirmed();
    latest_status = status + (HatchCameraLocal::healthy()
                                  ? ""
                                  : " / Durable event storage unavailable");
    latest_captured = success ? job.captured : 0;
    latest_inference_ms = (esp_timer_get_time() - started) / 1000;
    xSemaphoreGive(result_mutex);
    heap_caps_free(job.data);
    // Yield between jobs and never build a queue of stale frames.
    vTaskDelay(pdMS_TO_TICKS(20));
    xSemaphoreGive(detection_slot);
  }
}

static esp_err_t index_handler(httpd_req_t *req) {
  extern const char page_start[] asm("_binary_index_html_start");
  extern const char page_end[] asm("_binary_index_html_end");
  httpd_resp_set_type(req, "text/html");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");
  return httpd_resp_send(req, page_start, page_end - page_start);
}

static esp_err_t capture_handler(httpd_req_t *req) {
  const int64_t request_started = esp_timer_get_time();
  char query[64], value[16];
  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK &&
      httpd_query_key_value(query, "confidence", value, sizeof(value)) ==
          ESP_OK) {
    char *end;
    float confidence = strtof(value, &end);
    if (end == value || *end != '\0' || !std::isfinite(confidence) ||
        confidence < 0.5f || confidence > 0.95f) {
      return httpd_resp_send_err(
          req, HTTPD_400_BAD_REQUEST,
          "Classification confidence must be between 0.5 and 0.95");
    }
    xSemaphoreTake(result_mutex, portMAX_DELAY);
    requested_confidence = confidence;
    xSemaphoreGive(result_mutex);
  }
  camera_fb_t *frame = esp_camera_fb_get();
  if (frame == NULL) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Cache-Control", "no-store");
  const int64_t now = esp_timer_get_time();
  std::string boxes, detector_status;
  int64_t inference_ms, age_ms;
  xSemaphoreTake(result_mutex, portMAX_DELAY);
  inference_ms = latest_inference_ms;
  detector_status = latest_status;
  age_ms = latest_captured ? (now - latest_captured) / 1000 : -1;
  boxes = age_ms >= 0 && age_ms < 2000 ? latest_boxes : "[]";
  xSemaphoreGive(result_mutex);
  char elapsed[24], age[24], capture_ms[24];
  snprintf(elapsed, sizeof(elapsed), "%lld", (long long)inference_ms);
  snprintf(age, sizeof(age), "%lld", (long long)age_ms);
  httpd_resp_set_hdr(req, "X-Detections", boxes.c_str());
  httpd_resp_set_hdr(req, "X-Inference-Ms", elapsed);
  httpd_resp_set_hdr(req, "X-Detection-Age-Ms", age);
  httpd_resp_set_hdr(req, "X-Detector-Status", detector_status.c_str());
  snprintf(capture_ms, sizeof(capture_ms), "%lld",
           (long long)((esp_timer_get_time() - request_started) / 1000));
  httpd_resp_set_hdr(req, "X-Capture-Ms", capture_ms);
  esp_err_t result = httpd_resp_send(req, (const char *)frame->buf, frame->len);
  const int64_t total_ms = (esp_timer_get_time() - request_started) / 1000;
  if (total_ms > 500)
    ESP_LOGW(TAG, "Slow preview: capture=%s ms, total=%lld ms, JPEG=%u bytes",
             capture_ms, (long long)total_ms, (unsigned)frame->len);
  esp_camera_fb_return(frame);
  return result;
}

static void start_web_server(void) {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.stack_size = 16384;
  // Keep HTTP work separate from the MobileNetV2 task pinned to core 1.
  config.core_id = 0;
  config.send_wait_timeout = 15;
  httpd_handle_t server = NULL;
  httpd_uri_t index_uri = {
      .uri = "/", .method = HTTP_GET, .handler = index_handler};
  httpd_uri_t capture_uri = {
      .uri = "/capture", .method = HTTP_GET, .handler = capture_handler};
  ESP_ERROR_CHECK(httpd_start(&server, &config));
  ESP_ERROR_CHECK(httpd_register_uri_handler(server, &index_uri));
  ESP_ERROR_CHECK(httpd_register_uri_handler(server, &capture_uri));
  ESP_LOGI(TAG, "Camera setup AP: http://192.168.5.1");
}

static void start_access_point(void) {
  // NVS initialization is handled without erasing existing data in app_main.
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_t *ap = esp_netif_create_default_wifi_ap();
  // The controller AP is 192.168.4.1; use a separate subnet for camera setup.
  esp_netif_ip_info_t ap_ip = {};
  IP4_ADDR(&ap_ip.ip, 192, 168, 5, 1);
  IP4_ADDR(&ap_ip.gw, 192, 168, 5, 1);
  IP4_ADDR(&ap_ip.netmask, 255, 255, 255, 0);
  const esp_err_t stopped = esp_netif_dhcps_stop(ap);
  if (stopped != ESP_OK && stopped != ESP_ERR_ESP_NETIF_DHCP_ALREADY_STOPPED)
    ESP_ERROR_CHECK(stopped);
  ESP_ERROR_CHECK(esp_netif_set_ip_info(ap, &ap_ip));
  ESP_ERROR_CHECK(esp_netif_dhcps_start(ap));
  esp_netif_create_default_wifi_sta();
  esp_timer_create_args_t retry_config = {};
  retry_config.callback = retry_wifi;
  retry_config.name = "wifi-retry";
  ESP_ERROR_CHECK(esp_timer_create(&retry_config, &wifi_retry_timer));
  ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                             wifi_event, nullptr));
  wifi_init_config_t wifi_init = WIFI_INIT_CONFIG_DEFAULT();
  wifi_init.nvs_enable = false;
  ESP_ERROR_CHECK(esp_wifi_init(&wifi_init));
  wifi_config_t ap_config = {
      .ap =
          {
              .ssid = "ESP32-CAM",
              .password = "12345678",
              .ssid_len = 9,
              .channel = 1,
              .authmode = WIFI_AUTH_WPA2_PSK,
              .max_connection = 4,
          },
  };
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
  snprintf((char *)ap_config.ap.ssid, sizeof(ap_config.ap.ssid), "HATCH-CAM-%s",
           HatchCameraLocal::position() == 0   ? "Upper"
           : HatchCameraLocal::position() == 1 ? "Lower"
                                               : "Unknown");
  ap_config.ap.ssid_len = strlen((char *)ap_config.ap.ssid);
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_config));
  wifi_config_t station = {};
  strlcpy((char *)station.sta.ssid, HatchLink::WifiSsid,
          sizeof(station.sta.ssid));
  strlcpy((char *)station.sta.password, HatchLink::WifiPassword,
          sizeof(station.sta.password));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &station));
  ESP_ERROR_CHECK(esp_wifi_start());
  ESP_LOGI(TAG, "Camera preview hotspot active; placement %s",
           HatchCameraLocal::position() == 0   ? "Upper"
           : HatchCameraLocal::position() == 1 ? "Lower"
                                               : "unassigned");
}

extern "C" void app_main(void) {
  ESP_LOGI(TAG, "ESP32-S3 camera starting (%s)",
           strlen(HatchCameraLocal::id()) ? HatchCameraLocal::id()
                                          : "unassigned");

  size_t psram_size = heap_caps_get_total_size(MALLOC_CAP_SPIRAM);

  ESP_LOGI(TAG, "Detected PSRAM: %u bytes", (unsigned int)psram_size);

  if (psram_size > 0) {
    ESP_LOGI(TAG, "PSRAM initialization successful!");
  } else {
    ESP_LOGE(TAG, "PSRAM not detected!");
    return;
  }

  camera_config_t config = {
      .pin_pwdn = -1,
      .pin_reset = -1,
      .pin_xclk = 15,
      .pin_sccb_sda = 4,
      .pin_sccb_scl = 5,
      .pin_d7 = 16,
      .pin_d6 = 17,
      .pin_d5 = 18,
      .pin_d4 = 12,
      .pin_d3 = 10,
      .pin_d2 = 8,
      .pin_d1 = 9,
      .pin_d0 = 11,
      .pin_vsync = 6,
      .pin_href = 7,
      .pin_pclk = 13,
      .xclk_freq_hz = 20000000,
      .ledc_timer = LEDC_TIMER_0,
      .ledc_channel = LEDC_CHANNEL_0,
      .pixel_format = PIXFORMAT_JPEG,
      .frame_size = FRAMESIZE_VGA,
      .jpeg_quality = 12,
      .fb_count = 2,
      .grab_mode = CAMERA_GRAB_LATEST,
  };

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    ESP_LOGE(TAG, "Camera initialization failed: 0x%x", err);
    return;
  }
  ESP_LOGI(TAG, "Camera initialized successfully");

  camera_fb_t *frame = esp_camera_fb_get();
  if (frame == NULL) {
    ESP_LOGE(TAG, "Camera frame capture failed");
    return;
  }
  ESP_LOGI(TAG, "Camera frame captured: %u bytes, %ux%u", (unsigned)frame->len,
           frame->width, frame->height);
  esp_camera_fb_return(frame);

  boot_id = esp_random();
  const auto nvsResult = nvs_flash_init();
  if (nvsResult != ESP_OK)
    ESP_LOGE(TAG, "NVS unavailable; preserved without erase");
  HatchCameraLocal::begin(boot_id);
  start_access_point();
  result_mutex = xSemaphoreCreateMutex();
  detection_slot = xSemaphoreCreateBinary();
  detection_queue = xQueueCreate(1, sizeof(DetectionJob));
  ESP_ERROR_CHECK(result_mutex && detection_slot && detection_queue
                      ? ESP_OK
                      : ESP_ERR_NO_MEM);
  ESP_ERROR_CHECK(xTaskCreatePinnedToCore(detection_task, "mobilenet", 16384,
                                          nullptr, 2, nullptr, 1) == pdPASS
                      ? ESP_OK
                      : ESP_ERR_NO_MEM);

  ESP_ERROR_CHECK(
      xTaskCreate(capture_task, "capture", 4096, nullptr, 1, nullptr) == pdPASS
          ? ESP_OK
          : ESP_ERR_NO_MEM);
  ESP_ERROR_CHECK(xTaskCreate(link_task, "camera-link", 12288, nullptr, 1,
                              nullptr) == pdPASS
                      ? ESP_OK
                      : ESP_ERR_NO_MEM);
  start_web_server();
}
