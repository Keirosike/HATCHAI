#include "Sht40Sensor.h"
#include "Sht40Protocol.h"

Sht40Sensor::Sht40Sensor(uint8_t address) : _address(address) {}

void Sht40Sensor::begin() {
  // main.cpp owns Wire initialization and its bounded I2C timeout.
  _startedMs=millis(); _initialized=true;
  Wire.beginTransmission(_address);
  const bool detected=Wire.endTransmission()==0;
  Serial.printf("SHT40 I2C %s at 0x%02X; measurements require valid CRC\n",detected?"detected":"not detected",_address);
}

SensorReading Sht40Sensor::read() {
  SensorReading reading;
  reading.timestampMs=millis();
  if(!_initialized) { reading.error="SHT40 not initialized"; return reading; }
  if(uint32_t(reading.timestampMs-_startedMs)<HatchConfig::SensorStartupMs) {
    reading.error="SHT40 starting up"; return reading;
  }
  Wire.beginTransmission(_address);
  Wire.write(HatchSht40::MeasureHighPrecision);
  if(Wire.endTransmission()!=0) {
    reading.error="SHT40 I2C command failed; check sensor wiring/address"; return reading;
  }
  // Required conversion interval, one bounded attempt; no busy polling/retries.
  // Sensor heater commands are never used for incubation measurements.
  delay(HatchConfig::Sht40ConversionMs);
  uint8_t bytes[6];
  const size_t received=Wire.requestFrom(_address,uint8_t(sizeof(bytes)));
  if(received!=sizeof(bytes) || Wire.available()!=sizeof(bytes)) {
    while(Wire.available()) Wire.read();
    reading.error="SHT40 I2C short read or timeout"; return reading;
  }
  for(uint8_t i=0;i<sizeof(bytes);++i) bytes[i]=Wire.read();
  if(!HatchSht40::validFrame(bytes,sizeof(bytes))) {
    reading.error="SHT40 CRC error"; return reading;
  }
  reading.temperatureC=HatchSht40::temperature((uint16_t(bytes[0])<<8)|bytes[1]);
  reading.humidityPercent=HatchSht40::humidity((uint16_t(bytes[3])<<8)|bytes[4]);
  // Preserve the existing application/model range, narrower than the sensor's.
  if(!isfinite(reading.temperatureC) || !isfinite(reading.humidityPercent) ||
      reading.temperatureC < -40 || reading.temperatureC > 80) {
    reading.error="SHT40 reading outside incubator permitted range"; return reading;
  }
  reading.timestampMs=millis(); reading.valid=true; reading.error="";
  _latest=reading; return reading;
}
SensorReading Sht40Sensor::latest() const { return _latest; }
bool Sht40Sensor::hasValidReading() const { return _latest.valid; }
