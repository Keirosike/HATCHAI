#include "mobilenet_detector.hpp"
#include "MobileNetInput.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "tensorflow/lite/micro/schema/schema_generated.h"
#include <cmath>
#include <cstdio>
namespace {
float lastProbability = 0;
constexpr size_t ArenaBytes = 4 * 1024 * 1024;
uint8_t *arena;
tflite::MicroInterpreter *interpreter;
extern const uint8_t
    modelStart[] asm("_binary_mobilenetv2_full_int8_tflite_start");
extern const uint8_t modelEnd[] asm("_binary_mobilenetv2_full_int8_tflite_end");
} // namespace
bool mobilenet_init() {
  const auto model = tflite::GetModel(modelStart);
  if (model->version() != TFLITE_SCHEMA_VERSION)
    return false;
  static tflite::MicroMutableOpResolver<7> resolver;
  if (resolver.AddMul() != kTfLiteOk || resolver.AddAdd() != kTfLiteOk ||
      resolver.AddConv2D() != kTfLiteOk ||
      resolver.AddDepthwiseConv2D() != kTfLiteOk ||
      resolver.AddMean() != kTfLiteOk ||
      resolver.AddFullyConnected() != kTfLiteOk ||
      resolver.AddLogistic() != kTfLiteOk)
    return false;
  arena = static_cast<uint8_t *>(heap_caps_aligned_alloc(
      16, ArenaBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (!arena)
    return false;
  static tflite::MicroInterpreter runtime(model, resolver, arena, ArenaBytes);
  interpreter = &runtime;
  if (runtime.AllocateTensors() != kTfLiteOk)
    return false;
  const auto input = runtime.input(0), output = runtime.output(0);
  if (input->type != kTfLiteInt8 || input->dims->size != 4 ||
      input->dims->data[0] != 1 || input->dims->data[1] != 160 ||
      input->dims->data[2] != 160 || input->dims->data[3] != 3 ||
      input->params.scale != 1.0f || input->params.zero_point != -128 ||
      output->type != kTfLiteInt8 || output->dims->size != 2 ||
      output->dims->data[0] != 1 || output->dims->data[1] != 1 ||
      output->bytes != 1 || output->params.scale != 1.0f / 256 ||
      output->params.zero_point != -128)
    return false;
  ESP_LOGI("MOBILENET",
           "INT8 160x160 RGB classifier ready; model=%u arena used=%u "
           "reserved=%u PSRAM free=%u",
           unsigned(modelEnd - modelStart),
           unsigned(runtime.arena_used_bytes()), unsigned(ArenaBytes),
           unsigned(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)));
  return true;
}
bool mobilenet_detect(const uint8_t *rgb, int width, int height,
                      float confidence, std::string &detections,
                      std::string &status) {
  if (!interpreter || !std::isfinite(confidence) || confidence < .5f ||
      confidence > .95f) {
    status = "MobileNet unavailable/invalid threshold";
    return false;
  }
  if (!HatchMobileNet::usable(rgb, width, height)) {
    detections = "[]";
    status = "Unusable uniform frame; no confirmation";
    return false;
  }
  auto input = interpreter->input(0);
  if (!HatchMobileNet::prepare(rgb, width, height, input->data.int8,
                               input->bytes)) {
    status = "MobileNet resize failed";
    return false;
  }
  const int64_t invokeStart = esp_timer_get_time();
  if (interpreter->Invoke() != kTfLiteOk) {
    status = "MobileNet inference failed";
    return false;
  }
  const uint32_t invokeMs =
      uint32_t((esp_timer_get_time() - invokeStart) / 1000);
  const float score = lastProbability =
      HatchMobileNet::probability(interpreter->output(0)->data.int8[0]);
  char text[160];
  if (score >= confidence) {
    snprintf(text, sizeof(text),
             "[{\"class\":1,\"name\":\"chick\",\"kind\":\"classification\","
             "\"score\":%.6f}]",
             score);
    detections = text;
  } else
    detections = "[]";
  snprintf(text, sizeof(text),
           "MobileNetV2 INT8: chick probability %.3f / invoke %lu ms / PSRAM "
           "free %u",
           score, (unsigned long)invokeMs,
           unsigned(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)));
  status = text;
  return true;
}

uint16_t mobilenet_confidence() {
  return uint16_t(lastProbability * 1000 + .5f);
}
