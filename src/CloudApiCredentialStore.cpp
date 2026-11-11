#include "CloudApiCredentialStore.h"
#include <Preferences.h>
#include "NotificationPairingProtocol.h"

namespace { constexpr const char* Ns="hatchai-sync"; constexpr uint8_t Version=1; }

bool CloudApiCredentialStore::load(CloudApiCredential& out){
  memset(&out,0,sizeof(out));Preferences p;if(!p.begin(Ns,true))return false;
  const String device=p.getString("api-device","");const String keyId=p.getString("api-key-id","");
  const bool valid=p.getBool("api-enabled",false)&&p.getUChar("api-version",0)==Version&&
    device==HatchPairing::ControllerId&&HatchPairing::validKeyId(keyId.c_str())&&
    keyId.length()<=64&&p.getBytesLength("api-key")==32&&p.getBytes("api-key",out.key,32)==32;
  p.end();if(!valid){HatchPairing::erase(&out,sizeof(out));return false;}
  strlcpy(out.deviceId,device.c_str(),sizeof(out.deviceId));strlcpy(out.keyId,keyId.c_str(),sizeof(out.keyId));return true;
}

bool CloudApiCredentialStore::loadPending(CloudApiCredential& out){
  memset(&out,0,sizeof(out));Preferences p;if(!p.begin(Ns,true))return false;
  const String device=p.getString("api-device","");const String keyId=p.getString("api-key-id","");
  const bool valid=!p.getBool("api-enabled",false)&&p.getUChar("api-version",0)==Version&&device==HatchPairing::ControllerId&&HatchPairing::validKeyId(keyId.c_str())&&keyId.length()<=64&&p.getBytesLength("api-key")==32&&p.getBytes("api-key",out.key,32)==32;
  p.end();if(!valid){HatchPairing::erase(&out,sizeof(out));return false;}strlcpy(out.deviceId,device.c_str(),sizeof(out.deviceId));strlcpy(out.keyId,keyId.c_str(),sizeof(out.keyId));return true;
}

bool CloudApiCredentialStore::stage(const char* deviceId,const char* keyId,const uint8_t key[32]){
  if(!deviceId||strcmp(deviceId,HatchPairing::ControllerId)||!keyId||!HatchPairing::validKeyId(keyId)||strlen(keyId)>64||!key)return false;
  Preferences p;if(!p.begin(Ns,false))return false;
  if(p.getBool("api-enabled",false)){p.end();return false;}
  bool ok=p.putBool("api-enabled",false)==1&&p.putUChar("api-version",Version)==1&&
    p.putString("api-device",deviceId)==strlen(deviceId)&&p.putString("api-key-id",keyId)==strlen(keyId)&&
    p.putBytes("api-key",key,32)==32;
  uint8_t check[32]{};ok=ok&&p.getUChar("api-version",0)==Version&&p.getString("api-device","")==deviceId&&
    p.getString("api-key-id","")==keyId&&p.getBytes("api-key",check,32)==32&&
    memcmp(check,key,32)==0;
  HatchPairing::erase(check,sizeof(check));p.end();
  return ok;
}

bool CloudApiCredentialStore::activate(const CloudApiCredential& expected){
  CloudApiCredential pending;if(!loadPending(pending))return false;const bool same=!strcmp(pending.deviceId,expected.deviceId)&&!strcmp(pending.keyId,expected.keyId)&&memcmp(pending.key,expected.key,32)==0;HatchPairing::erase(&pending,sizeof(pending));if(!same)return false;
  Preferences p;if(!p.begin(Ns,false))return false;const bool ok=p.putBool("api-enabled",true)==1;p.end();return ok;
}
