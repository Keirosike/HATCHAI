#pragma once

#include <stdint.h>

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
constexpr uint8_t Dht22Pin = 4;
constexpr uint8_t LcdColumns = 20;
constexpr uint8_t LcdRows = 4;

constexpr uint8_t SdCardCsPin = 5;
constexpr uint8_t SdCardSckPin = 18;
constexpr uint8_t SdCardMisoPin = 19;
constexpr uint8_t SdCardMosiPin = 23;
constexpr const char* SdLogPath = "/hatchai.csv";
constexpr uint32_t SensorLogIntervalMs = 10000;
constexpr uint32_t RecoveryCheckpointIntervalMs = 60000;
constexpr uint32_t RecoveryCommitTimeoutMs = 10000;
constexpr uint32_t RecoveryBootTimeoutMs = 15000;
constexpr uint32_t RecoveryResumeTurnDelaySeconds = 120;
constexpr uint32_t MaximumUnreviewedOfflineSeconds = 7UL * 86400;
constexpr uint32_t SdSpiFrequency = 4000000;
constexpr uint32_t SdLogRotateBytes = 256 * 1024;
constexpr uint8_t SdLogArchives = 3;
constexpr uint16_t RecoveryMaxJsonBytes = 4096;
constexpr uint8_t DefaultIncubationDays = 21;

// Restored four-relay layout: IN1 fan, IN2 bulb, IN3 batch 1, IN4 batch 2.
constexpr uint8_t FanRelayPin = 14;
constexpr uint8_t Bulb1RelayPin = 27;
constexpr uint8_t TurnerRelayPin = 26;
constexpr uint8_t Turner2RelayPin = 25;
constexpr bool RelayActiveHigh = false;

constexpr float DefaultTargetTemperatureC = 37.5f;
constexpr float DefaultTargetHumidityPercent = 55.0f;
constexpr float FanCutoffAboveTargetC = 0.5f;
constexpr uint16_t DefaultTurnIntervalMinutes = 120;

constexpr uint32_t SensorReadIntervalMs = 5000;
constexpr uint32_t SensorStaleAfterMs = 20000;
constexpr uint8_t SensorRecoverySamples = 3;
constexpr float SensorRecoveryStepC = 0.5f;
constexpr float SensorFilterAlpha = 0.35f;
constexpr float HeaterInhibitC = 38.0f;
constexpr float HeaterResumeC = 37.5f;
constexpr float HighTemperatureC = 38.5f;
constexpr float CriticalTemperatureC = 39.0f;
constexpr float LowTemperatureC = 36.5f;
constexpr float LowClearC = 37.0f;
constexpr uint32_t LowWarningWarmupMs = 1800000;
constexpr uint32_t LowWarningDelayMs = 600000;
constexpr uint32_t MotorGapMs = 1000;
constexpr uint32_t LockdownAfterSeconds = 17UL * 86400; // start of chicken day 18
constexpr uint32_t RecoveryRetryIntervalMs = 30000;
constexpr uint32_t WatchdogSeconds = 8;
constexpr float HeaterHysteresisC = 0.3f;
constexpr uint32_t HeaterRelayMinimumOffMs = 5000;
// Legacy PID constants are retained only for old checkpoint validation.
// Main firmware uses RelayThermostat.
constexpr float HeaterPidKp = 20.0f;
constexpr float HeaterPidKi = 0.04f;
constexpr float HeaterPidKd = 100.0f;
constexpr float HeaterPidDerivativeFilterSeconds = 10.0f;
constexpr uint32_t HeaterRelayWindowMs = 20000;
constexpr uint32_t HeaterRelayMinimumSwitchMs = HeaterRelayMinimumOffMs;
constexpr uint32_t HeaterWindowLateMs = 250;
constexpr float HeaterPidRampPercentPerSecond = 2.5f;
constexpr uint32_t TurnerPulseMs = 15000;
constexpr uint16_t MinManualTurnSeconds = 1;
constexpr uint16_t MaxManualTurnSeconds = 600;
constexpr uint32_t LcdRefreshIntervalMs = 2000;
constexpr uint32_t WifiForgetGraceMs = 750;
constexpr uint32_t WifiConnectStartDelayMs = 250;
constexpr uint32_t WifiConnectSettleMs = 1000;
constexpr uint32_t WifiConnectTimeoutMs = 20000;
constexpr uint32_t WifiReconnectIntervalMs = 30000;
constexpr uint8_t WifiScanResultLimit = 20;

}
