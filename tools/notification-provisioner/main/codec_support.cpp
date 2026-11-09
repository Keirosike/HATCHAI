#include "NotificationPairingProtocol.h"
// RAM utility links the production record codec, without Arduino/JSON/TLS protocol code.
// Native cross-checks compare these small identity predicates with the full production module.
namespace HatchPairing {
void erase(void* bytes,size_t length) { volatile uint8_t* p=static_cast<volatile uint8_t*>(bytes);while(length--)*p++=0; }
bool validKeyId(const std::string& value) {
  if(value.empty()||value.size()>64)return false;
  for(unsigned char c:value)if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'||c=='-'))return false;
  return true;
}
bool Credentials::valid() const {return deviceId==ControllerId&&validKeyId(keyId)&&keyLength==32;}
}
