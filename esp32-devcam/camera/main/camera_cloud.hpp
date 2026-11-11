#pragma once
#include <stddef.h>
#include <stdint.h>
namespace HatchCameraCloud {
void begin();
// Transfers ownership of PSRAM JPEG only on success. No sockets/NVS in caller.
bool submit(uint8_t* jpeg,size_t length,int64_t capturedMonotonicUs);
}
