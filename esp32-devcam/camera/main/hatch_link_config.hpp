#pragma once
#if __has_include("../../../include/CameraLinkSecrets.h")
#include "../../../include/CameraLinkSecrets.h"
#endif
// Use the router SSID/password here for internet push. Defaults join the incubator AP.
// Both boards must share the same network for local camera status/video.
#if defined(HATCHAI_CAMERA_UPPER) && defined(HATCHAI_CAMERA_LOWER)
#error "Select only one physical camera placement"
#endif
namespace HatchLink {
#if defined(HATCHAI_CAMERA_UPPER)
constexpr char CameraId[]="hatchai-inc01-cam01";
#elif defined(HATCHAI_CAMERA_LOWER)
constexpr char CameraId[]="hatchai-inc01-cam02";
#else
constexpr char CameraId[]=""; // Existing unassigned camera remains compatible.
#endif
constexpr char WifiSsid[] = "HatchAI-ESP32";
constexpr char WifiPassword[] = "hatchai123";
constexpr char ControllerUrl[] = "http://192.168.4.1";
// Set an identical random >=32-character key in include/CameraLinkConfig.h.
#if defined(HATCHAI_CAMERA_UPPER) && defined(HATCHAI_CAMERA_UPPER_LOCAL_KEY)
constexpr char LocalKey[]=HATCHAI_CAMERA_UPPER_LOCAL_KEY;
#elif defined(HATCHAI_CAMERA_LOWER) && defined(HATCHAI_CAMERA_LOWER_LOCAL_KEY)
constexpr char LocalKey[]=HATCHAI_CAMERA_LOWER_LOCAL_KEY;
#elif !defined(HATCHAI_CAMERA_UPPER) && !defined(HATCHAI_CAMERA_LOWER) && defined(HATCHAI_CAMERA_LOCAL_KEY)
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
constexpr bool LegacyPushEnabled=false; // Native Worker transport is separately credential-gated.
constexpr unsigned AlertCooldownSeconds = 60;
}
