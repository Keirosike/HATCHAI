#include <Arduino.h>
#include <SPIFFS.h>
#include <Wire.h>
#include "Config.h"
#include "DataLogger.h"
#include "HatchWebServer.h"
#include "IncubatorController.h"
#include "LcdStatusDisplay.h"
#include "NetworkManager.h"
#include "OutputDevice.h"
#include "RealTimeClock.h"
#include "Sht40Sensor.h"

Sht40Sensor environmentSensor(HatchConfig::Sht40I2cAddress);
OutputDevice bulb1Relay(
  HatchConfig::Bulb1RelayPin,
  HatchConfig::RelayActiveHigh,
  "Bulb 1"
);
OutputDevice bulb2Relay(
  HatchConfig::Bulb2RelayPin,
  HatchConfig::RelayActiveHigh,
  "Bulb 2"
);
OutputDevice fanRelay(
  HatchConfig::FanRelayPin,
  HatchConfig::RelayActiveHigh,
  "Fan"
);
OutputDevice turnerRelay(
  HatchConfig::TurnerRelayPin,
  HatchConfig::RelayActiveHigh,
  "Egg turner"
);
RealTimeClock realTimeClock(HatchConfig::Ds3231Address);
DataLogger dataLogger(HatchConfig::SdCardCsPin, HatchConfig::SdLogPath);
LcdStatusDisplay lcdDisplay(
  HatchConfig::LcdI2cAddress,
  HatchConfig::LcdColumns,
  HatchConfig::LcdRows
);

IncubatorController incubator(
  environmentSensor,
  bulb1Relay,
  bulb2Relay,
  fanRelay,
  turnerRelay,
  realTimeClock,
  dataLogger,
  lcdDisplay
);
NetworkManager network;
HatchWebServer webServer(incubator, network);

void setup() {
  Serial.begin(HatchConfig::SerialBaud);
  delay(100);
  Wire.begin(HatchConfig::I2cSdaPin, HatchConfig::I2cSclPin);

  if (!SPIFFS.begin(true)) {
    Serial.println("SPIFFS mount failed. Web files will not be available.");
  }

  incubator.begin();
  network.begin();
  webServer.begin();
}

void loop() {
  incubator.setNetworkStatus(network.statusText());
  incubator.update();
  webServer.handleClient();
  delay(2);
}
