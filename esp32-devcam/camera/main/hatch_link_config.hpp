#pragma once
#if __has_include("../../../include/CameraLinkSecrets.h")
#include "../../../include/CameraLinkSecrets.h"
#endif
// Use the router SSID/password here for internet push. Defaults join the incubator AP.
// Both boards must share the same network for local camera status/video.
namespace HatchLink {
constexpr char WifiSsid[] = "HatchAI-ESP32";
constexpr char WifiPassword[] = "hatchai123";
constexpr char ControllerUrl[] = "http://192.168.4.1";
// Set an identical random >=32-character key in include/CameraLinkConfig.h.
#ifdef HATCHAI_CAMERA_LOCAL_KEY
constexpr char LocalKey[] = HATCHAI_CAMERA_LOCAL_KEY;
#else
constexpr char LocalKey[] = "";
#endif
// Firebase Hosting URL, e.g. https://hatchai-8d34c.web.app/api/chick
constexpr char PushUrl[] = "https://hatchai-8d34c.web.app/api/chick";
// Match the deployed CAMERA_SECRET; never put this value in browser code.
#ifdef HATCHAI_CAMERA_PUSH_KEY
constexpr char PushKey[] = HATCHAI_CAMERA_PUSH_KEY;
#else
constexpr char PushKey[] = "";
#endif
constexpr unsigned AlertCooldownSeconds = 60;
}
