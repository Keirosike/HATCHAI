#include "espdet_detect.hpp"
#include "esp_log.h"
#include <filesystem>

extern const uint8_t hatchai_esp32s3_espdl[] asm("_binary_hatchai_esp32s3_espdl_start");
static const char *path = (const char *)hatchai_esp32s3_espdl;
namespace espdet_detect {
ESPDet::ESPDet(const char *model_name, float score_thr, float nms_thr)
{
    // This is a single EDL2 model, rather than a named model in a packed bundle.
    m_model = new dl::Model(path, fbs::MODEL_LOCATION_IN_FLASH_RODATA);
    m_model->minimize();
    m_image_preprocessor = new dl::image::ImagePreprocessor(m_model, {0, 0, 0}, {255, 255, 255});
    m_image_preprocessor->enable_letterbox({114, 114, 114});
    m_postprocessor = new dl::detect::ESPDetPostProcessor(
        m_model, m_image_preprocessor, score_thr, nms_thr, 10, {{8, 8, 4, 4}, {16, 16, 8, 8}, {32, 32, 16, 16}});
}

} // namespace espdet_detect

ESPDetDetect::ESPDetDetect(model_type_t model_type, bool lazy_load) : m_model_type(model_type)
{
    switch (model_type) {
    case model_type_t::ESPDET_PICO_imgH_imgW_CUSTOM:
        m_score_thr[0] = espdet_detect::ESPDet::default_score_thr;
        m_nms_thr[0] = espdet_detect::ESPDet::default_nms_thr;
        break;
    }
    if (lazy_load) {
        m_model = nullptr;
    } else {
        load_model();
    }
}

void ESPDetDetect::load_model()
{
    switch (m_model_type) {
    case model_type_t::ESPDET_PICO_imgH_imgW_CUSTOM:
        m_model = new espdet_detect::ESPDet("hatchai_esp32s3.espdl", m_score_thr[0], m_nms_thr[0]);
        break;
    }
}
