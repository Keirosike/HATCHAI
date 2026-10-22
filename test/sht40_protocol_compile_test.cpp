#include "Sht40Protocol.h"
using namespace HatchSht40;
constexpr uint8_t reference[]={0xbe,0xef};
static_assert(crc(reference,2)==0x92,"Sensirion published CRC test vector");
constexpr uint8_t good[]={0xbe,0xef,0x92,0xbe,0xef,0x92};
constexpr uint8_t badT[]={0xbf,0xef,0x92,0xbe,0xef,0x92};
constexpr uint8_t badRh[]={0xbe,0xef,0x92,0xbe,0xef,0x93};
static_assert(validFrame(good,6),"Both CRCs must pass");
static_assert(!validFrame(badT,6) && !validFrame(badRh,6),"Reject corrupt temperature and humidity independently");
static_assert(!validFrame(good,5) && !validFrame(good,0),"Reject partial frames");
static_assert(temperature(0)==-45 && temperature(65535)==130,"Temperature conversion endpoints");
static_assert(temperature(30895)>37.49 && temperature(30895)<37.51,"Incubation temperature conversion");
static_assert(humidity(31981)>54.99 && humidity(31981)<55.01,"Incubation RH conversion");
static_assert(humidity(0)==0 && humidity(65535)==100,"Clamp RH as specified by Sensirion");
