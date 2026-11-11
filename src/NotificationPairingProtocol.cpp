#include "NotificationPairingProtocol.h"
#include <ArduinoJson.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <vector>
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP_PLATFORM)
#include <mbedtls/sha256.h>
#include <mbedtls/md.h>
#include <mbedtls/version.h>
#elif defined(_WIN32)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <bcrypt.h>
#else
#error Provide a reviewed crypto backend for this platform
#endif

namespace HatchPairing {
void erase(void* bytes, size_t length) {
  volatile uint8_t* p = static_cast<volatile uint8_t*>(bytes);
  while (length--) *p++ = 0;
}
bool validKeyId(const std::string& value) {
  if (value.empty() || value.size() > 64) return false;
  for (unsigned char c : value) if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
  return true;
}
bool validId(const std::string& value) { return value.size() >= 20 && validKeyId(value); }
bool validCode(const std::string& value) {
  if (value.size() != 16) return false;
  for (char c : value) if (!((c >= 'A' && c <= 'Z') || (c >= '2' && c <= '7'))) return false;
  return true;
}
bool Credentials::valid() const { return deviceId == ControllerId && validKeyId(keyId) && keyLength == 32; }
void SignedRequest::clear() { method.clear(); path.clear(); body.clear(); canonical.clear(); payloadHash.clear(); signature.clear(); }

namespace {
bool utf16(const std::string& s, std::vector<uint16_t>& units) {
  units.clear();
  for (size_t i = 0; i < s.size();) {
    uint32_t cp = static_cast<uint8_t>(s[i++]); size_t continuation = 0; uint32_t minimum = 0;
    if (cp < 128) {}
    else if ((cp & 0xe0) == 0xc0) { cp &= 31; continuation = 1; minimum = 0x80; }
    else if ((cp & 0xf0) == 0xe0) { cp &= 15; continuation = 2; minimum = 0x800; }
    else if ((cp & 0xf8) == 0xf0) { cp &= 7; continuation = 3; minimum = 0x10000; }
    else return false;
    if (i + continuation > s.size()) return false;
    for (size_t n = 0; n < continuation; n++) {
      const uint8_t c = static_cast<uint8_t>(s[i++]); if ((c & 0xc0) != 0x80) return false;
      cp = (cp << 6) | (c & 63);
    }
    if (cp < minimum || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return false;
    if (cp < 0x10000) units.push_back(static_cast<uint16_t>(cp));
    else { cp -= 0x10000; units.push_back(0xd800 | (cp >> 10)); units.push_back(0xdc00 | (cp & 1023)); }
  }
  return true;
}
// Validate the entire document first: ArduinoJson alone can stop at a root
// container and leave trailing input. Also reject lossy NUL/lone-surrogate strings.
class Grammar {
  const std::string& s; size_t p = 0, nodes = 0;
  void ws() { while (p < s.size() && (s[p]==' ' || s[p]=='\t' || s[p]=='\r' || s[p]=='\n')) ++p; }
  bool hex(uint32_t& value) {
    value = 0;
    for (unsigned n=0;n<4;n++) {
      if(p>=s.size()) return false; const char c=s[p++]; int v=-1;
      if(c>='0'&&c<='9')v=c-'0'; else if(c>='a'&&c<='f')v=c-'a'+10; else if(c>='A'&&c<='F')v=c-'A'+10;
      if(v<0)return false; value=(value<<4)|unsigned(v);
    }
    return true;
  }
  bool str() {
    if(p>=s.size()||s[p++]!='"')return false;
    while(p<s.size()) {
      const unsigned char c=s[p++]; if(c=='"')return true; if(c<32)return false;
      if(c=='\\') {
        if(p>=s.size())return false; const char e=s[p++];
        if(e=='u') {
          uint32_t u; if(!hex(u)||u==0)return false;
          if(u>=0xd800&&u<=0xdbff) {
            if(p+2>s.size()||s[p++]!='\\'||s[p++]!='u')return false;
            uint32_t low; if(!hex(low)||low<0xdc00||low>0xdfff)return false;
          } else if(u>=0xdc00&&u<=0xdfff)return false;
        } else if(std::strchr("\"\\/bfnrt",e)==nullptr)return false;
      }
    }
    return false;
  }
  bool number() {
    if(p<s.size()&&s[p]=='-')++p;
    if(p>=s.size())return false;
    if(s[p]=='0')++p;
    else { if(s[p]<'1'||s[p]>'9')return false; while(p<s.size()&&s[p]>='0'&&s[p]<='9')++p; }
    if(p<s.size()&&s[p]=='.') { ++p; const size_t begin=p; while(p<s.size()&&s[p]>='0'&&s[p]<='9')++p; if(p==begin)return false; }
    if(p<s.size()&&(s[p]=='e'||s[p]=='E')) {
      ++p; if(p<s.size()&&(s[p]=='+'||s[p]=='-'))++p; const size_t begin=p;
      while(p<s.size()&&s[p]>='0'&&s[p]<='9')++p; if(p==begin)return false;
    }
    return true;
  }
  bool value(size_t depth) {
    ws(); if(depth>MaxDepth||++nodes>MaxNodes||p>=s.size())return false;
    if(s[p]=='"')return str();
    if(s[p]=='{'||s[p]=='[') {
      const bool object=s[p++]=='{'; const char end=object?'}':']'; ws();
      if(p<s.size()&&s[p]==end){++p;return true;}
      while(p<s.size()) {
        if(object) { if(!str())return false; ws(); if(p>=s.size()||s[p++]!=':')return false; }
        if(!value(depth+1))return false; ws(); if(p>=s.size())return false;
        if(s[p]==end){++p;return true;} if(s[p++]!=',')return false; ws();
      }
      return false;
    }
    for(const char* literal:{"true","false","null"}) {
      const size_t length=std::strlen(literal);
      if(s.compare(p,length,literal)==0){p+=length;return true;}
    }
    return number();
  }
public:
  explicit Grammar(const std::string& input):s(input){}
  bool run(){if(!value(0))return false;ws();return p==s.size();}
};
bool append(std::string& out, const std::string& value) {
  if(value.size()>MaxJson-out.size())return false;out+=value;return true;
}
bool quote(const std::string& s,std::string& out) {
  std::vector<uint16_t> check;if(!utf16(s,check)||!append(out,"\""))return false;
  for(unsigned char c:s) {
    if(c=='"'){if(!append(out,"\\\""))return false;}
    else if(c=='\\'){if(!append(out,"\\\\"))return false;}
    else if(c=='\b'){if(!append(out,"\\b"))return false;}
    else if(c=='\f'){if(!append(out,"\\f"))return false;}
    else if(c=='\n'){if(!append(out,"\\n"))return false;}
    else if(c=='\r'){if(!append(out,"\\r"))return false;}
    else if(c=='\t'){if(!append(out,"\\t"))return false;}
    else if(c<32){char escaped[7];std::snprintf(escaped,sizeof(escaped),"\\u%04x",unsigned(c));if(!append(out,escaped))return false;}
    else if(!append(out,std::string(1,char(c))))return false;
  }
  return append(out,"\"");
}
struct Member { std::string key; std::vector<uint16_t> order; JsonVariantConst value; };
bool canonicalValue(JsonVariantConst value,std::string& out,size_t depth,size_t& nodes) {
  if(depth>MaxDepth||++nodes>MaxNodes)return false;
  if(value.isNull())return append(out,"null");
  if(value.is<bool>())return append(out,value.as<bool>()?"true":"false");
  if(value.is<const char*>()) { const JsonString s=value.as<JsonString>();return quote(std::string(s.c_str(),s.size()),out); }
  if(value.is<JsonObjectConst>()) {
    std::vector<Member> members;
    for(JsonPairConst p:value.as<JsonObjectConst>()) {
      Member m;m.key=p.key().c_str();if(!utf16(m.key,m.order))return false;m.value=p.value();members.push_back(m);
    }
    std::sort(members.begin(),members.end(),[](const Member& a,const Member& b){return a.order<b.order;});
    if(!append(out,"{"))return false;bool first=true;
    for(const Member& m:members) {
      if(!first&&!append(out,","))return false;first=false;
      if(!quote(m.key,out)||!append(out,":")||!canonicalValue(m.value,out,depth+1,nodes))return false;
    }
    return append(out,"}");
  }
  if(value.is<JsonArrayConst>()) {
    if(!append(out,"["))return false;bool first=true;
    for(JsonVariantConst child:value.as<JsonArrayConst>()) {
      if(!first&&!append(out,","))return false;first=false;if(!canonicalValue(child,out,depth+1,nodes))return false;
    }
    return append(out,"]");
  }
  // JS JSON.stringify uses IEEE754 numbers. Restrict the protocol to the safe
  // integral domain instead of relying on implementation-dependent float printing.
  const double n=value.as<double>();
  if(!std::isfinite(n)||std::fabs(n)>9007199254740991.0||std::floor(n)!=n)return false;
  char number[32];std::snprintf(number,sizeof(number),"%lld",static_cast<long long>(n));
  return append(out,number);
}
bool digest(const uint8_t* data,size_t length,const uint8_t* key,size_t keyLength,uint8_t output[32]) {
#if defined(ARDUINO_ARCH_ESP32) || defined(ESP_PLATFORM)
  if(key) return mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),key,keyLength,data,length,output)==0;
#if MBEDTLS_VERSION_MAJOR >= 3
  return mbedtls_sha256(data,length,output,0)==0;
#else
  return mbedtls_sha256_ret(data,length,output,0)==0;
#endif
#else
  BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE hash=nullptr;bool ok=false;
  if(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,key?BCRYPT_ALG_HANDLE_HMAC_FLAG:0)>=0) {
    if(BCryptCreateHash(algorithm,&hash,nullptr,0,const_cast<PUCHAR>(key),ULONG(keyLength),0)>=0) {
      ok=BCryptHashData(hash,const_cast<PUCHAR>(data),ULONG(length),0)>=0 && BCryptFinishHash(hash,output,32,0)>=0;
      BCryptDestroyHash(hash);
    }
    BCryptCloseAlgorithmProvider(algorithm,0);
  }
  return ok;
#endif
}
bool supported(const std::string& method,const std::string& path) {
  return method=="POST"&&(path=="/device/pairing/challenge"||path=="/device/pairing/start"||
    path=="/device/telemetry"||path=="/device/pairing/status"||path=="/device/pairing/cancel");
}
}
bool validJson(const std::string& input) {
  if(input.empty()||input.size()>MaxJson)return false;std::vector<uint16_t> check;
  return utf16(input,check)&&Grammar(input).run();
}
bool canonicalJson(const std::string& input,std::string& output) {
  output.clear();if(!validJson(input))return false;DynamicJsonDocument doc(8192);
  if(deserializeJson(doc,input,DeserializationOption::NestingLimit(MaxDepth+1)))return false;
  size_t nodes=0;if(!canonicalValue(doc.as<JsonVariantConst>(),output,0,nodes)){output.clear();return false;}return true;
}
std::string base64url(const uint8_t* bytes,size_t length) {
  if((!bytes&&length)||length>MaxJson)return "";
  const char* alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";std::string out;
  uint32_t bits=0;unsigned available=0;
  for(size_t i=0;i<length;i++){bits=(bits<<8)|bytes[i];available+=8;while(available>=6){available-=6;out+=alphabet[(bits>>available)&63];}}
  if(available)out+=alphabet[(bits<<(6-available))&63];return out;
}
static bool scopedSign(const std::string& method,const std::string& path,const std::string& input,
          const Credentials& credentials,SignedRequest& output,bool camera) {
  const bool authorized=camera ? (method=="POST" && (path=="/device/camera-events"||path=="/device/camera-captures") &&
    (credentials.deviceId=="hatchai-inc01-cam01"||credentials.deviceId=="hatchai-inc01-cam02") && validKeyId(credentials.keyId) && credentials.keyLength==32) : credentials.valid()&&supported(method,path);
  output.clear();if(!authorized||!validJson(input))return false;
  DynamicJsonDocument doc(8192);if(deserializeJson(doc,input,DeserializationOption::NestingLimit(MaxDepth+1))||!doc.is<JsonObject>())return false;
  if(!doc["deviceId"].is<const char*>()||!doc["keyId"].is<const char*>()||
    credentials.deviceId!=doc["deviceId"].as<const char*>()||credentials.keyId!=doc["keyId"].as<const char*>())return false;
  doc.remove("signature");size_t nodes=0;SignedRequest candidate;
  if(!canonicalValue(doc.as<JsonVariantConst>(),candidate.canonical,0,nodes))return false;
  uint8_t hash[32]={};
  if(!digest(reinterpret_cast<const uint8_t*>(candidate.canonical.data()),candidate.canonical.size(),nullptr,0,hash))return false;
  candidate.payloadHash=base64url(hash,32);
  const std::string message="HATCHAI-NOTIFY-v1\n"+method+"\n"+path+"\n"+candidate.payloadHash;
  const bool ok=digest(reinterpret_cast<const uint8_t*>(message.data()),message.size(),credentials.key,credentials.keyLength,hash);
  if(ok)candidate.signature=base64url(hash,32);erase(hash,sizeof(hash));if(!ok)return false;
  candidate.method=method;candidate.path=path;
  candidate.body=candidate.canonical.substr(0,candidate.canonical.size()-1)+",\"signature\":\""+candidate.signature+"\"}";
  if(candidate.body.size()>MaxJson)return false;output=candidate;return true;
}
bool sign(const std::string& method,const std::string& path,const std::string& input,const Credentials& credentials,SignedRequest& output){return scopedSign(method,path,input,credentials,output,false);}
bool signCamera(const std::string& path,const std::string& input,const Credentials& credentials,SignedRequest& output){return scopedSign("POST",path,input,credentials,output,true);}
bool signTelemetry(const Credentials& credentials,const TelemetryFrame& sample,const std::string& eventId,uint32_t issuedAt,const std::string& nonce,SignedRequest& output){
  output.clear();if(!credentials.valid()||issuedAt<1704067200U||issuedAt>=4102444800U||sample.capturedAt<1704067200U||sample.capturedAt>=4102444800U||eventId.size()!=36||nonce.size()<24||nonce.size()>64||!validKeyId(nonce))return false;
  for(size_t i=0;i<36;i++){const char c=eventId[i];if(i==8||i==13||i==18||i==23){if(c!='-')return false;}else if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;}
  if(eventId[14]!='4'||(eventId[19]!='8'&&eventId[19]!='9'&&eventId[19]!='a'&&eventId[19]!='b'))return false;
  if(sample.upperCamera < -1||sample.upperCamera>1||sample.lowerCamera < -1||sample.lowerCamera>1||
     (sample.valid&&(sample.temperatureCenti < -4000||sample.temperatureCenti>8000||sample.humidityCenti>10000||sample.sensorAgeMs>=20000)))return false;
  char temp[16],humidity[16],age[16],json[1400];
  snprintf(temp,sizeof(temp),"%d",int(sample.temperatureCenti));snprintf(humidity,sizeof(humidity),"%u",unsigned(sample.humidityCenti));snprintf(age,sizeof(age),"%u",unsigned(sample.sensorAgeMs));
  const auto boolean=[](bool b){return b?"true":"false";};
  const auto camera=[](int8_t value){return value<0?"null":value==1?"true":"false";};
  const int n=snprintf(json,sizeof(json),"{\"deviceId\":\"%s\",\"issuedAt\":%lu,\"keyId\":\"%s\",\"nonce\":\"%s\",\"sample\":{\"autoMode\":%s,\"capturedAt\":%lu,\"eventId\":\"%s\",\"fanOn\":null,\"heaterOn\":%s,\"humidityCenti\":%s,\"lowerCameraOnline\":%s,\"lowerChick\":%s,\"lowerOn\":%s,\"sensorAgeMs\":%s,\"sensorValid\":%s,\"temperatureCenti\":%s,\"upperCameraOnline\":%s,\"upperChick\":%s,\"upperOn\":%s}}",
    credentials.deviceId.c_str(),(unsigned long)issuedAt,credentials.keyId.c_str(),nonce.c_str(),boolean(sample.automatic),(unsigned long)sample.capturedAt,eventId.c_str(),boolean(sample.heater),sample.valid?humidity:"null",camera(sample.lowerCamera),sample.lowerCamera==1?boolean(sample.lowerChick):"null",boolean(sample.lower),sample.valid?age:"null",boolean(sample.valid),sample.valid?temp:"null",camera(sample.upperCamera),sample.upperCamera==1?boolean(sample.upperChick):"null",boolean(sample.upper));
  if(n<=0||size_t(n)>=sizeof(json))return false;
  SignedRequest candidate;candidate.canonical.assign(json,n);uint8_t hash[32]={};
  if(!digest(reinterpret_cast<const uint8_t*>(candidate.canonical.data()),candidate.canonical.size(),nullptr,0,hash))return false;
  candidate.payloadHash=base64url(hash,32);const std::string message="HATCHAI-NOTIFY-v1\nPOST\n/device/telemetry\n"+candidate.payloadHash;
  const bool ok=digest(reinterpret_cast<const uint8_t*>(message.data()),message.size(),credentials.key,32,hash);if(ok)candidate.signature=base64url(hash,32);erase(hash,sizeof(hash));if(!ok)return false;
  candidate.method="POST";candidate.path="/device/telemetry";candidate.body=candidate.canonical.substr(0,candidate.canonical.size()-1)+",\"signature\":\""+candidate.signature+"\"}";output=candidate;return true;
}
bool verify(const std::string& method,const std::string& path,const std::string& input,
            const Credentials& credentials,const std::string& signature) {
  SignedRequest expected;if(signature.size()!=43||!sign(method,path,input,credentials,expected))return false;
  unsigned difference=0;for(size_t i=0;i<43;i++)difference|=unsigned(uint8_t(signature[i])^uint8_t(expected.signature[i]));
  return difference==0;
}
}
