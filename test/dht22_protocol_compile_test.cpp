#include "Dht22Protocol.h"
#include "Config.h"
constexpr uint8_t Good[]={0x02,0x26,0x01,0x79,0xa2}; // 55.0% RH, 37.7 C
constexpr uint8_t Negative[]={0x02,0x26,0x80,0x64,0x0c}; // -10.0 C
constexpr uint8_t Corrupt[]={0x02,0x26,0x01,0x79,0xa3};
constexpr uint8_t HumidityRange[]={0x03,0xe9,0,0,0xec};
constexpr uint8_t TemperatureRange[]={0,0,0x03,0x21,0x24};
static_assert(HatchDht22::validFrame(Good,5),"Valid DHT22 checksum and range");
static_assert(HatchDht22::temperature(Good)>37.69f && HatchDht22::temperature(Good)<37.71f,"Temperature scale");
static_assert(HatchDht22::humidity(Good)==55.0f,"Humidity scale");
static_assert(HatchDht22::validFrame(Negative,5) && HatchDht22::temperature(Negative)==-10.0f,"Signed temperature");
static_assert(!HatchDht22::validFrame(Corrupt,5),"Reject corrupt checksum");
static_assert(!HatchDht22::validFrame(Good,4),"Reject truncated frame");
static_assert(!HatchDht22::validFrame(HumidityRange,5),"Reject humidity above 100%");
static_assert(!HatchDht22::validFrame(TemperatureRange,5),"Reject temperature above 80C");
static_assert(HatchConfig::Dht22Pin!=HatchConfig::PassiveBuzzerPin && HatchConfig::FanRelayPin<0,"No fan/buzzer/sensor pin conflict");
static_assert(HatchConfig::compatibleRecoveryFanPin(14) && HatchConfig::compatibleRecoveryFanPin(-1),"Preserve previous and current recovery metadata");
static_assert(!HatchConfig::compatibleRecoveryFanPin(4) && !HatchConfig::compatibleRecoveryFanPin(27),"Reject unexpected recovery fan metadata");
