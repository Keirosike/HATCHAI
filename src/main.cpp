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

Sht40Sensor environmentSensor(HatchConfig::Sht40Address);
OutputDevice bulb1Relay(
  HatchConfig::Bulb1RelayPin,
  HatchConfig::RelayActiveHigh,
  "Bulb (IN2)"
);
OutputDevice fanRelay(
  HatchConfig::FanRelayPin,
  HatchConfig::RelayActiveHigh,
  "Fan"
);
OutputDevice turnerRelay(
  HatchConfig::TurnerRelayPin,
  HatchConfig::RelayActiveHigh,
  "Lower roller (IN4)"
);
OutputDevice turner2Relay(
  HatchConfig::Turner2RelayPin,
  HatchConfig::RelayActiveHigh,
  "Upper roller (IN3)"
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
  fanRelay,
  turnerRelay,
  turner2Relay,
  realTimeClock,
  dataLogger,
  lcdDisplay
);
NetworkManager network;
HatchWebServer webServer(incubator, network);

void setup() {
  incubator.initializeOutputs(); // safe relay levels before serial, buses or storage
  Serial.begin(HatchConfig::SerialBaud);
  delay(100);
  Wire.begin(HatchConfig::I2cSdaPin, HatchConfig::I2cSclPin);
  Wire.setTimeOut(25);
  incubator.begin();

  if (!SPIFFS.begin(false)) {
    Serial.println("SPIFFS mount failed. Web files will not be available.");
  }

  network.begin();
  webServer.begin();
}

void loop() {
  network.update();
  incubator.setNetworkStatus(network.statusText());
  incubator.update();
  webServer.handleClient();
  incubator.completeLoop(); // only feed after the entire HTTP/control loop completes
  delay(2);
}
