#pragma once
#if __has_include("CameraLinkSecrets.h")
#include "CameraLinkSecrets.h"
#endif
namespace HatchCamera {
// Match HatchLink::LocalKey in the camera firmware. Empty disables incoming events.
#ifdef HATCHAI_CAMERA_LOCAL_KEY
constexpr const char* Key = HATCHAI_CAMERA_LOCAL_KEY;
#else
constexpr const char* Key = "";
#endif
constexpr const char* UpperId="hatchai-inc01-cam01";
constexpr const char* LowerId="hatchai-inc01-cam02";
#ifdef HATCHAI_CAMERA_UPPER_LOCAL_KEY
constexpr const char* UpperKey=HATCHAI_CAMERA_UPPER_LOCAL_KEY;
#else
constexpr const char* UpperKey="";
#endif
#ifdef HATCHAI_CAMERA_LOWER_LOCAL_KEY
constexpr const char* LowerKey=HATCHAI_CAMERA_LOWER_LOCAL_KEY;
#else
constexpr const char* LowerKey="";
#endif
constexpr const char* NotificationsUrl = "https://hatchai-8d34c.web.app/";
}
