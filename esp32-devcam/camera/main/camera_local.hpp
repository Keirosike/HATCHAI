#pragma once
#include "CameraEventProtocol.h"
namespace HatchCameraLocal {
void begin(uint32_t boot);
const char *mac();
const char *id();
int position();
bool observe(bool detectorOk, bool chick, uint16_t confidence,
             uint64_t capturedMs);
bool pending(HatchCameraEvent::Event &, uint32_t &ageMs, bool &ageKnown);
bool acknowledge(const char *eventId);
void synchronize(uint32_t utc);
bool confirmed();
bool healthy();
} // namespace HatchCameraLocal
