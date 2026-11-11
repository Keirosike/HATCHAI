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
#include "Dht22Sensor.h"
#include "CloudSync.h"
#include <time.h>

Dht22Sensor environmentSensor(HatchConfig::Dht22Pin);
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
CloudSync cloudSync;
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
  cloudSync.begin();
  webServer.attachCloudSync(&cloudSync);
}

void loop() {
  network.update();
  incubator.setNetworkStatus(network.statusText());
  incubator.update();
  static uint32_t lastCloudSample=0;
  if(cloudSync.ready()&&uint32_t(millis()-lastCloudSample)>=5000){
    lastCloudSample=millis();const auto reading=environmentSensor.latest();const auto settings=incubator.settings();
    const uint32_t age=millis()-reading.timestampMs;const uint64_t utc=time(nullptr);
    const float calibrated=reading.temperatureC+settings.temperatureOffsetC;
    const bool valid=reading.valid&&age<20000&&isfinite(calibrated)&&calibrated>=-40&&calibrated<=80;
    if(utc>=1704067200ULL&&utc<4102444800ULL){CloudSyncSample sample{};sample.capturedAt=utc;sample.valid=valid;sample.temperatureCenti=valid?lroundf(calibrated*100):0;sample.humidityCenti=valid?lroundf(reading.humidityPercent*100):0;sample.sensorAgeMs=valid?age:0;sample.heater=bulb1Relay.isOn();sample.lower=turnerRelay.isOn();sample.upper=turner2Relay.isOn();sample.automatic=settings.autoMode;webServer.cameraSnapshot(sample.upperCamera,sample.lowerCamera,sample.upperChick,sample.lowerChick);cloudSync.submit(sample);}
  }
  webServer.handleClient();
  incubator.completeLoop(); // only feed after the entire HTTP/control loop completes
  delay(2);
}
