
#include <stdio.h>
#include <string>
#include <cstring>
#include <cstdlib>
#include <cmath>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "esp_timer.h"
#include "esp_random.h"
#include "esp_sntp.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_camera.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "fomo_detector.hpp"
#include "hatch_link_config.hpp"
#include "camera_cloud.hpp"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include <time.h>
#include "dl_image_jpeg.hpp"
#include "esp_log.h"
#include "esp_heap_caps.h"

static const char *TAG = "HATCHAI_CAMERA";
struct DetectionJob { uint8_t *data; size_t length; int64_t captured; };
static QueueHandle_t detection_queue;
static SemaphoreHandle_t detection_slot;
static SemaphoreHandle_t result_mutex;
static std::string latest_boxes = "[]";
static std::string latest_status = "Waiting for first inference";
static int64_t latest_captured = 0;
static int64_t latest_inference_ms = 0;
static float requested_confidence = 0.5f;
static QueueHandle_t alert_queue;
static uint32_t alert_sequence = 0;
static unsigned qualified_hits = 0;
static int64_t last_alert = -60000000;
static bool detector_ok = false;
static bool chick_present = false;
static uint32_t boot_id = 0;
static esp_timer_handle_t wifi_retry_timer;
static std::string localController=HatchLink::ControllerUrl;

static bool post_event(const std::string &url, const char *key, const char *body) {
    if (url.empty() || strlen(key)<32) return false;
    esp_http_client_config_t config = {};
    config.url=url.c_str(); config.timeout_ms=3000;
    config.crt_bundle_attach=esp_crt_bundle_attach;
    esp_http_client_handle_t client=esp_http_client_init(&config);
    if (!client) return false;
    esp_http_client_set_method(client,HTTP_METHOD_POST);
    esp_http_client_set_header(client,"Content-Type","application/json");
    esp_http_client_set_header(client,"X-Camera-Key",key);
    esp_http_client_set_post_field(client,body,strlen(body));
    esp_err_t err=esp_http_client_perform(client);
    const int status=esp_http_client_get_status_code(client);
    esp_http_client_cleanup(client);
    return err==ESP_OK && status>=200 && status<300;
}
static void link_task(void *) {
    uint32_t pending=0; unsigned retries=0;
    while(true) {
        uint32_t next;
        if(xQueueReceive(alert_queue,&next,pdMS_TO_TICKS(5000))==pdTRUE) { pending=next; retries=0; }
        esp_netif_ip_info_t ip={};
        esp_netif_t *netif=esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
        if(!netif || esp_netif_get_ip_info(netif,&ip)!=ESP_OK || !ip.ip.addr) continue;
        char address[24],body[256];
        snprintf(address,sizeof(address),IPSTR,IP2STR(&ip.ip));
        xSemaphoreTake(result_mutex,portMAX_DELAY);
        const bool ok=detector_ok && latest_captured && esp_timer_get_time()-latest_captured<10000000;
        const bool present=ok && chick_present;
        uint32_t sequence=alert_sequence;
        xSemaphoreGive(result_mutex);
        snprintf(body,sizeof(body),"{\"ip\":\"%s\",\"detectorOk\":%s,\"chick\":%s,\"sequence\":%lu,\"boot\":%lu}",address,ok?"true":"false",present?"true":"false",(unsigned long)sequence,(unsigned long)boot_id);
        if(strlen(HatchLink::CameraId)){const size_t used=strlen(body);if(used&&used+strlen(HatchLink::CameraId)+16<sizeof(body))snprintf(body+used-1,sizeof(body)-used+1,",\"cameraId\":\"%s\"}",HatchLink::CameraId);}
        post_event(localController+"/api/camera/event",HatchLink::LocalKey,body);
        if(HatchLink::LegacyPushEnabled && pending && time(nullptr)>1704067200 && strlen(HatchLink::PushUrl) && retries<3) {
            char event[128];
            snprintf(event,sizeof(event),"{\"eventId\":\"%08lx-%lu\"}",(unsigned long)boot_id,(unsigned long)pending);
            if(post_event(HatchLink::PushUrl,HatchLink::PushKey,event)) pending=0;
            else { ++retries; ESP_LOGW(TAG,"Push delivery failed, attempt %u/3",retries); }
        }
    }
}
static void capture_task(void *) {
    while(true) {
        if(xSemaphoreTake(detection_slot,pdMS_TO_TICKS(1000))!=pdTRUE) continue;
        camera_fb_t *frame=esp_camera_fb_get();
        bool queued=false;
        if(frame) {
            auto *copy=static_cast<uint8_t *>(heap_caps_malloc(frame->len,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));
            if(copy) {
                memcpy(copy,frame->buf,frame->len);
                DetectionJob job={copy,frame->len,esp_timer_get_time()};
                queued=xQueueSend(detection_queue,&job,0)==pdTRUE;
                if(!queued) heap_caps_free(copy);
            }
            esp_camera_fb_return(frame);
        }
        if(!queued) xSemaphoreGive(detection_slot);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
static void retry_wifi(void *) {
    esp_wifi_connect();
}
static void wifi_event(void *,esp_event_base_t base,int32_t id,void *) {
    if(base!=WIFI_EVENT) return;
    if(id==WIFI_EVENT_STA_START) esp_wifi_connect();
    if(id==WIFI_EVENT_STA_DISCONNECTED) {
        // Avoid continuous station scans disrupting the camera's setup hotspot.
        esp_timer_stop(wifi_retry_timer);
        esp_timer_start_once(wifi_retry_timer,30000000);
    }
    if(id==WIFI_EVENT_STA_CONNECTED) esp_timer_stop(wifi_retry_timer);
}


static bool run_detection(camera_fb_t *frame, float confidence, std::string &boxes, std::string &status)
{
    dl::image::jpeg_img_t jpeg = {
        .data = frame->buf,
        .data_len = frame->len,
    };
    auto image = dl::image::sw_decode_jpeg(jpeg, dl::image::DL_IMAGE_PIX_TYPE_RGB888);
    if (image.data == NULL) {
        ESP_LOGW(TAG, "Could not decode JPEG for detection");
        status = "JPEG decoding failed";
        return false;
    }
    bool success = fomo_detect(static_cast<const uint8_t *>(image.data), image.width, image.height, confidence, boxes, status);
    heap_caps_free(image.data);
    return success;
}

static void detection_task(void *)
{
    if (!fomo_init()) {
        ESP_LOGE(TAG, "FOMO initialization failed: insufficient memory");
        xSemaphoreTake(result_mutex, portMAX_DELAY);
        latest_status = "FOMO initialization failed";
        xSemaphoreGive(result_mutex);
        vTaskDelete(nullptr);
        return;
    }
    HatchCameraCloud::begin(); // Start cloud allocation only after inference initialization succeeds.
    ESP_LOGI(TAG, "Chick-only FOMO background detection enabled");
    xSemaphoreGive(detection_slot);
    DetectionJob job;
    while (true) {
        if (xQueueReceive(detection_queue, &job, portMAX_DELAY) != pdTRUE) continue;
        camera_fb_t frame = {};
        frame.buf = job.data;
        frame.len = job.length;
        std::string boxes, status;
        xSemaphoreTake(result_mutex, portMAX_DELAY);
        float confidence = requested_confidence;
        xSemaphoreGive(result_mutex);
        int64_t started = esp_timer_get_time();
        bool success = run_detection(&frame, confidence, boxes, status);
        bool cloudEvent=false;
        xSemaphoreTake(result_mutex, portMAX_DELAY);
        latest_boxes = success ? boxes : "[]";
        detector_ok=success;
        chick_present=success && boxes!="[]";
        qualified_hits=chick_present ? (qualified_hits<3 ? qualified_hits+1 : 3) : 0;
        const int64_t now=esp_timer_get_time();
        if(qualified_hits>=3 && now-last_alert>=int64_t(HatchLink::AlertCooldownSeconds)*1000000) {
            cloudEvent=true;last_alert=now; ++alert_sequence;
            xQueueOverwrite(alert_queue,&alert_sequence);
        }
        latest_status = status;
        latest_captured = success ? job.captured : 0;
        latest_inference_ms = (esp_timer_get_time() - started) / 1000;
        xSemaphoreGive(result_mutex);
        if(!cloudEvent||!HatchCameraCloud::submit(job.data,job.length,job.captured))heap_caps_free(job.data);
        // Yield between jobs and never build a queue of stale frames.
        vTaskDelay(pdMS_TO_TICKS(20));
        xSemaphoreGive(detection_slot);
    }
}

static esp_err_t index_handler(httpd_req_t *req)
{
    extern const char page_start[] asm("_binary_index_html_start");
    extern const char page_end[] asm("_binary_index_html_end");
    httpd_resp_set_type(req, "text/html");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, page_start, page_end - page_start);
}

static esp_err_t capture_handler(httpd_req_t *req)
{
    const int64_t request_started = esp_timer_get_time();
    char query[64], value[16];
    if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK &&
        httpd_query_key_value(query, "confidence", value, sizeof(value)) == ESP_OK) {
        char *end;
        float confidence = strtof(value, &end);
        if (end == value || *end != '\0' || !std::isfinite(confidence) || confidence < 0.1f || confidence > 0.9f) {
            return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "FOMO confidence must be between 0.1 and 0.9");
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
    snprintf(capture_ms,sizeof(capture_ms),"%lld",(long long)((esp_timer_get_time()-request_started)/1000));
    httpd_resp_set_hdr(req,"X-Capture-Ms",capture_ms);
    esp_err_t result = httpd_resp_send(req, (const char *)frame->buf, frame->len);
    const int64_t total_ms=(esp_timer_get_time()-request_started)/1000;
    if(total_ms>500) ESP_LOGW(TAG,"Slow preview: capture=%s ms, total=%lld ms, JPEG=%u bytes",capture_ms,(long long)total_ms,(unsigned)frame->len);
    esp_camera_fb_return(frame);
    return result;
}

static void start_web_server(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size = 16384;
    // Keep HTTP work separate from the FOMO task pinned to core 1.
    config.core_id = 0;
    config.send_wait_timeout = 15;
    httpd_handle_t server = NULL;
    httpd_uri_t index_uri = {.uri = "/", .method = HTTP_GET, .handler = index_handler};
    httpd_uri_t capture_uri = {.uri = "/capture", .method = HTTP_GET, .handler = capture_handler};
    ESP_ERROR_CHECK(httpd_start(&server, &config));
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &index_uri));
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &capture_uri));
    ESP_LOGI(TAG, "Camera setup AP: http://192.168.5.1");
}

static void start_access_point(void)
{
    ESP_ERROR_CHECK(nvs_flash_init());
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_t *ap=esp_netif_create_default_wifi_ap();
    // The controller AP is 192.168.4.1; use a separate subnet for camera setup.
    esp_netif_ip_info_t ap_ip={};
    IP4_ADDR(&ap_ip.ip,192,168,5,1); IP4_ADDR(&ap_ip.gw,192,168,5,1);
    IP4_ADDR(&ap_ip.netmask,255,255,255,0);
    const esp_err_t stopped=esp_netif_dhcps_stop(ap);
    if(stopped!=ESP_OK && stopped!=ESP_ERR_ESP_NETIF_DHCP_ALREADY_STOPPED) ESP_ERROR_CHECK(stopped);
    ESP_ERROR_CHECK(esp_netif_set_ip_info(ap,&ap_ip));
    ESP_ERROR_CHECK(esp_netif_dhcps_start(ap));
    esp_netif_create_default_wifi_sta();
    esp_timer_create_args_t retry_config={};
    retry_config.callback=retry_wifi;
    retry_config.name="wifi-retry";
    ESP_ERROR_CHECK(esp_timer_create(&retry_config,&wifi_retry_timer));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT,ESP_EVENT_ANY_ID,wifi_event,nullptr));
    wifi_init_config_t wifi_init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wifi_init));
    wifi_config_t ap_config = {
        .ap = {
            .ssid = "ESP32-CAM",
            .password = "12345678",
            .ssid_len = 9,
            .channel = 1,
            .authmode = WIFI_AUTH_WPA2_PSK,
            .max_connection = 4,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_config));
    wifi_config_t station={};
    strlcpy((char*)station.sta.ssid,HatchLink::WifiSsid,sizeof(station.sta.ssid));
    strlcpy((char*)station.sta.password,HatchLink::WifiPassword,sizeof(station.sta.password));
    // Optional administrative NVS configuration; never create/write it here.
    nvs_handle_t wifiStore;
    if(nvs_open("hatchai-wifi",NVS_READONLY,&wifiStore)==ESP_OK){
        char ssid[33]={},password[65]={},controller[80]={};size_t ssidSize=sizeof(ssid),passwordSize=sizeof(password),urlSize=sizeof(controller);
        if(nvs_get_str(wifiStore,"ssid",ssid,&ssidSize)==ESP_OK&&strlen(ssid)>0&&nvs_get_str(wifiStore,"password",password,&passwordSize)==ESP_OK&&strlen(password)>=8&&strlen(password)<=63){strlcpy((char*)station.sta.ssid,ssid,sizeof(station.sta.ssid));strlcpy((char*)station.sta.password,password,sizeof(station.sta.password));}
        if(nvs_get_str(wifiStore,"controller-url",controller,&urlSize)==ESP_OK){unsigned a,b,c,d;char extra;if(sscanf(controller,"http://%u.%u.%u.%u%c",&a,&b,&c,&d,&extra)==4&&a<=255&&b<=255&&c<=255&&d<=255&&(a==10||(a==192&&b==168)||(a==172&&b>=16&&b<=31))){char canonical[80];snprintf(canonical,sizeof(canonical),"http://%u.%u.%u.%u",a,b,c,d);if(strcmp(controller,canonical)==0)localController=controller;}}
        memset(password,0,sizeof(password));nvs_close(wifiStore);
    }

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA,&station));
    ESP_ERROR_CHECK(esp_wifi_start());
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0,"pool.ntp.org");
    esp_sntp_init();
    ESP_LOGI(TAG, "Wi-Fi hotspot: ESP32-CAM, password: 12345678");
}

extern "C" void app_main(void)
{
    ESP_LOGI(TAG, "ESP32-S3 camera starting (%s)",strlen(HatchLink::CameraId)?HatchLink::CameraId:"unassigned");

    size_t psram_size = heap_caps_get_total_size(MALLOC_CAP_SPIRAM);

    ESP_LOGI(TAG, "Detected PSRAM: %u bytes",
             (unsigned int)psram_size);

    if (psram_size > 0) {
        ESP_LOGI(TAG, "PSRAM initialization successful!");
    } else {
        ESP_LOGE(TAG, "PSRAM not detected!");
        return;
    }

    camera_config_t config = {
        .pin_pwdn = -1, .pin_reset = -1,
        .pin_xclk = 15, .pin_sccb_sda = 4, .pin_sccb_scl = 5,
        .pin_d7 = 16, .pin_d6 = 17, .pin_d5 = 18, .pin_d4 = 12,
        .pin_d3 = 10, .pin_d2 = 8, .pin_d1 = 9, .pin_d0 = 11,
        .pin_vsync = 6, .pin_href = 7, .pin_pclk = 13,
        .xclk_freq_hz = 20000000,
        .ledc_timer = LEDC_TIMER_0, .ledc_channel = LEDC_CHANNEL_0,
        .pixel_format = PIXFORMAT_JPEG,
        .frame_size = FRAMESIZE_VGA,
        .jpeg_quality = 12, .fb_count = 2,
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
    ESP_LOGI(TAG, "Camera frame captured: %u bytes, %ux%u",
             (unsigned)frame->len, frame->width, frame->height);
    esp_camera_fb_return(frame);

    boot_id=esp_random();
    start_access_point();
    alert_queue=xQueueCreate(1,sizeof(uint32_t));
    result_mutex = xSemaphoreCreateMutex();
    detection_slot = xSemaphoreCreateBinary();
    detection_queue = xQueueCreate(1, sizeof(DetectionJob));
    ESP_ERROR_CHECK(alert_queue && result_mutex && detection_slot && detection_queue ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(xTaskCreatePinnedToCore(detection_task, "fomo", 16384, nullptr, 2, nullptr, 1) == pdPASS
                    ? ESP_OK : ESP_ERR_NO_MEM);

    ESP_ERROR_CHECK(xTaskCreate(capture_task,"capture",4096,nullptr,1,nullptr)==pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(xTaskCreate(link_task,"camera-link",8192,nullptr,1,nullptr)==pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
    start_web_server();
}
