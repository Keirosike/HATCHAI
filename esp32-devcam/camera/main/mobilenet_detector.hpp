#pragma once
#include <stdint.h>
#include <string>
bool mobilenet_init();
bool mobilenet_detect(const uint8_t *rgb, int width, int height,
                      float confidence, std::string &detections,
                      std::string &status);

uint16_t mobilenet_confidence();
