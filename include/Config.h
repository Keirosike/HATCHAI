#pragma once

#include <Arduino.h>

namespace HatchConfig {

constexpr uint32_t SerialBaud = 115200;
constexpr uint16_t WebServerPort = 80;


// its own Wi-Fi access point named HatchAI-ESP32.
constexpr const char* WifiSsid = "YOUR_WIFI_SSID";
constexpr const char* WifiPassword = "YOUR_WIFI_PASSWORD";
constexpr const char* AccessPointSsid = "HatchAI-ESP32";
constexpr const char* AccessPointPassword = "hatchai123";

constexpr uint8_t I2cSdaPin = 21;
constexpr uint8_t I2cSclPin = 22;
constexpr uint8_t Ds3231Address = 0x68;
constexpr uint8_t LcdI2cAddress = 0x27;
constexpr uint8_t Sht40I2cAddress = 0x44;
constexpr uint8_t LcdColumns = 20;
constexpr uint8_t LcdRows = 4;

constexpr uint8_t SdCardCsPin = 5;
constexpr uint8_t SdCardSckPin = 18;
constexpr uint8_t SdCardMisoPin = 19;
constexpr uint8_t SdCardMosiPin = 23;
constexpr const char* SdLogPath = "/hatchai.csv";

constexpr uint8_t Bulb1RelayPin = 26;
constexpr uint8_t Bulb2RelayPin = 25;
constexpr uint8_t FanRelayPin = 14;
constexpr uint8_t TurnerRelayPin = 27;
constexpr bool RelayActiveHigh = false;

constexpr float DefaultTargetTemperatureC = 37.8f;
constexpr float DefaultTargetHumidityPercent = 58.0f;
constexpr uint16_t DefaultTurnIntervalMinutes = 120;

constexpr uint32_t SensorReadIntervalMs = 5000;
constexpr uint32_t SensorStaleAfterMs = 20000;
constexpr uint32_t TurnerPulseMs = 8000;
constexpr uint32_t LcdRefreshIntervalMs = 2000;

}
