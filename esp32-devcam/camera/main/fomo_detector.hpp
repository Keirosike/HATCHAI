#pragma once
#include <cstdint>
#include <string>

// Called by the single background inference task only.
bool fomo_init();
bool fomo_detect(const uint8_t *rgb, int width, int height, float confidence, std::string &detections, std::string &status);
