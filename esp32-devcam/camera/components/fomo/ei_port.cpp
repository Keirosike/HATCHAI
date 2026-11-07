#include "edge-impulse-sdk/porting/ei_classifier_porting.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <limits>

EI_IMPULSE_ERROR ei_run_impulse_check_canceled() { return EI_IMPULSE_OK; }
EI_IMPULSE_ERROR ei_sleep(int32_t ms) {
    if (ms > 0) vTaskDelay(pdMS_TO_TICKS(ms) ? pdMS_TO_TICKS(ms) : 1);
    return EI_IMPULSE_OK;
}
uint64_t ei_read_timer_ms() { return esp_timer_get_time() / 1000; }
uint64_t ei_read_timer_us() { return esp_timer_get_time(); }
void ei_putchar(char c) { putchar(c); }
void ei_printf(const char *format, ...) {
    va_list args; va_start(args, format); vprintf(format, args); va_end(args);
}
void ei_printf_float(float value) { printf("%f", value); }
void *ei_malloc(size_t size) {
    if (size >= 4096) return heap_caps_aligned_alloc(16, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    return heap_caps_aligned_alloc(16, size, MALLOC_CAP_8BIT);
}
void *ei_calloc(size_t count, size_t size) {
    if (size && count > std::numeric_limits<size_t>::max() / size) return nullptr;
    void *ptr = ei_malloc(count * size);
    if (ptr) memset(ptr, 0, count * size);
    return ptr;
}
void ei_free(void *ptr) { heap_caps_free(ptr); }
#if EI_C_LINKAGE == 1
extern "C"
#endif
void DebugLog(const char *text) { printf("%s", text); }
