#pragma once
#include <esp_task_wdt.h>
#include <esp_idf_version.h>
#include <esp_system.h>
#include "Config.h"
class RuntimeWatchdog {
public:
  void begin() {
    reason = esp_reset_reason();
    recoveryRequired = reason == ESP_RST_BROWNOUT || reason == ESP_RST_TASK_WDT ||
      reason == ESP_RST_INT_WDT || reason == ESP_RST_WDT || reason == ESP_RST_PANIC;
    esp_err_t result;
#if ESP_IDF_VERSION_MAJOR >= 5
    esp_task_wdt_config_t config = {};
    config.timeout_ms = HatchConfig::WatchdogSeconds * 1000;
    config.trigger_panic = true;
    result = esp_task_wdt_init(&config);
    if (result == ESP_ERR_INVALID_STATE) result = esp_task_wdt_reconfigure(&config);
#else
    result = esp_task_wdt_init(HatchConfig::WatchdogSeconds, true);
#endif
    if (result == ESP_OK && esp_task_wdt_status(nullptr) != ESP_OK)
      result = esp_task_wdt_add(nullptr);
    healthy = result == ESP_OK;
  }
  bool feed() { if (healthy) healthy = esp_task_wdt_reset() == ESP_OK; return healthy; }
  bool healthy = false, recoveryRequired = false;
  esp_reset_reason_t reason = ESP_RST_UNKNOWN;
};
