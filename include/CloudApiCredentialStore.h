#pragma once
#include <Arduino.h>
#include <stdint.h>

struct CloudApiCredential {
  char deviceId[65]{};
  char keyId[65]{};
  uint8_t key[32]{};
};

class CloudApiCredentialStore {
public:
  static bool load(CloudApiCredential& out);
  static bool loadPending(CloudApiCredential& out);
  static bool stage(const char* deviceId,const char* keyId,const uint8_t key[32]);
  static bool activate(const CloudApiCredential& expected);
};
