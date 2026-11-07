#include "fomo_detector.hpp"
#include "sdkconfig.h"
#include "edge-impulse-sdk/classifier/ei_run_classifier.h"
#include "edge-impulse-sdk/dsp/image/processing.hpp"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include <algorithm>
#include <cstdio>
#include <cstring>

static_assert(EI_HAS_FOMO == 1, "Export must contain a FOMO detector");
static_assert(EI_CLASSIFIER_INPUT_WIDTH == EI_CLASSIFIER_INPUT_HEIGHT, "Coordinate mapping expects a square input");
static_assert(EI_CLASSIFIER_RESIZE_MODE == EI_CLASSIFIER_RESIZE_FIT_SHORTEST, "Match export preprocessing");
static uint8_t *input_rgb;
static size_t input_capacity;
static ei_impulse_t camera_impulse;
static ei_postprocessing_block_t camera_postprocess = ei_default_impulse.impulse->postprocessing_blocks[0];
static ei_fill_result_fomo_i8_config_t camera_fomo_config;
static ei_impulse_handle_t *camera_handle;
static float peak_chick;
// Raw tensors are only valid during postprocessing, not after run_classifier returns.
static EI_IMPULSE_ERROR camera_fomo_postprocess(ei_impulse_handle_t *handle, uint32_t index,
        uint32_t input_id, ei_impulse_result_t *result, void *config, void *state) {
    auto *settings = static_cast<ei_fill_result_fomo_i8_config_t *>(config);
    ei::matrix_i8_t *raw = nullptr;
    peak_chick = 0;
    if (find_mtx_by_idx(result->_raw_outputs, &raw, input_id, handle->impulse->output_tensors_size) && raw) {
        const size_t channels = handle->impulse->label_count + 1;
        for (size_t i = 1; i < raw->rows * raw->cols; i += channels) {
            peak_chick = std::max(peak_chick, (int(raw->buffer[i]) - settings->zero_point) * settings->scale);
        }
    }
    return process_fomo_i8(handle, index, input_id, result, config, state);
}
static int image_signal(size_t offset, size_t length, float *out) {
    if (offset > EI_CLASSIFIER_RAW_SAMPLE_COUNT || length > EI_CLASSIFIER_RAW_SAMPLE_COUNT - offset) return -1;
    for (size_t i = 0; i < length; ++i) {
        const uint8_t *p = input_rgb + (offset + i) * 3;
        out[i] = static_cast<float>((uint32_t(p[0]) << 16) | (uint32_t(p[1]) << 8) | p[2]);
    }
    return 0;
}
bool fomo_init() {
    input_capacity = EI_CLASSIFIER_INPUT_WIDTH * EI_CLASSIFIER_INPUT_HEIGHT * 3;
    input_rgb = static_cast<uint8_t *>(heap_caps_malloc(
        input_capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!input_rgb) return false;
    // Keep the original model/DSP, but use direct FOMO results without the optional tracker.
    camera_impulse = *ei_default_impulse.impulse;
    camera_fomo_config = *static_cast<ei_fill_result_fomo_i8_config_t *>(camera_postprocess.config);
    camera_postprocess.config = &camera_fomo_config;
    camera_postprocess.postprocess_fn = camera_fomo_postprocess;
    camera_impulse.postprocessing_blocks = &camera_postprocess;
    camera_impulse.postprocessing_blocks_size = 1;
    camera_impulse.results_type = EI_CLASSIFIER_TYPE_OBJECT_DETECTION;
    camera_handle = new ei_impulse_handle_t(&camera_impulse);
    run_classifier_init(camera_handle);
    ESP_LOGI("FOMO", "Chick-only FOMO ready: %dx%d RGB INT8; adjustable confidence enabled",
             EI_CLASSIFIER_INPUT_WIDTH, EI_CLASSIFIER_INPUT_HEIGHT);
    return true;
}
bool fomo_detect(const uint8_t *rgb, int width, int height, float confidence, std::string &detections, std::string &status) {
    status = "FOMO input unavailable";
    if (!input_rgb || !rgb || width <= 0 || height <= 0) return false;
    const int side = std::min(width, height);
    // SDK crop-and-resize writes the full central crop before resizing in place.
    // Reserve that intermediate area, not only the final 240x240 pixels.
    size_t required = std::max(size_t(side) * side * 3,
                              size_t(EI_CLASSIFIER_INPUT_WIDTH) * EI_CLASSIFIER_INPUT_HEIGHT * 3);
    if (required > input_capacity) {
        auto *larger = static_cast<uint8_t *>(heap_caps_malloc(required, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
        if (!larger) { status = "FOMO crop allocation failed"; return false; }
        heap_caps_free(input_rgb);
        input_rgb = larger;
        input_capacity = required;
    }
    if (width == EI_CLASSIFIER_INPUT_WIDTH && height == EI_CLASSIFIER_INPUT_HEIGHT) {
        memcpy(input_rgb, rgb, required);
    } else if (ei::image::processing::resize_image_using_mode(rgb, width, height, input_rgb,
                   EI_CLASSIFIER_INPUT_WIDTH, EI_CLASSIFIER_INPUT_HEIGHT, 3, EI_CLASSIFIER_RESIZE_MODE) != 0) {
        status = "FOMO resize failed"; return false;
    }
    ei::signal_t signal;
    signal.total_length = EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE;
    signal.get_data = image_signal;
    ei_impulse_result_t result = {};
    camera_fomo_config.threshold = confidence;
    EI_IMPULSE_ERROR error = run_classifier(camera_handle, &signal, &result, false);
    if (error != EI_IMPULSE_OK) {
        ESP_LOGE("FOMO", "run_classifier failed: %d", error);
        status = "FOMO inference error " + std::to_string(int(error));
        return false;
    }
    const float scale = float(side) / EI_CLASSIFIER_INPUT_WIDTH;
    const int left = (width - side) / 2, top = (height - side) / 2;
    detections = "[";
    size_t count = 0;
    for (size_t i = 0; i < result.bounding_boxes_count; ++i) {
        const auto &bb = result.bounding_boxes[i];
        if (bb.value <= 0 || bb.value < confidence) continue;
        char json[220];
        const int x1 = left + int(bb.x * scale), y1 = top + int(bb.y * scale);
        const int x2 = left + int((bb.x + bb.width) * scale), y2 = top + int((bb.y + bb.height) * scale);
        snprintf(json, sizeof(json), "%s{\"class\":0,\"name\":\"chick\",\"kind\":\"centroid\",\"score\":%.4f,\"box\":[%d,%d,%d,%d]}",
                 detections.size() > 1 ? "," : "", bb.value, x1, y1, x2, y2);
        detections += json;
        ++count;
        ESP_LOGI("FOMO", "chick %.2f at (%d,%d)", bb.value, (x1+x2)/2, (y1+y2)/2);
    }
    detections += "]";
    char summary[140];
    snprintf(summary, sizeof(summary), "FOMO OK: peak chick %.1f%%; threshold %.0f%%; detections %u",
             peak_chick * 100, confidence * 100, unsigned(count));
    status = summary;
    static uint64_t last_log = 0;
    uint64_t now = ei_read_timer_ms();
    if (now - last_log >= 3000) { ESP_LOGI("FOMO", "%s", summary); last_log = now; }
    return true;
}
