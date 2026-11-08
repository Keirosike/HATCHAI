#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string>

namespace HatchPairing {
constexpr size_t MaxJson = 2048;
constexpr size_t MaxResponse = 1024;
constexpr size_t MaxDepth = 8;
constexpr size_t MaxNodes = 128;
constexpr const char* ControllerId = "hatchai-inc01-controller";
void erase(void* bytes, size_t length);

struct Credentials {
  std::string deviceId;
  std::string keyId;
  uint8_t key[32] = {};
  size_t keyLength = 0;
  bool valid() const;
  ~Credentials() { erase(key, sizeof(key)); }
};
struct SignedRequest {
  std::string method, path, body, canonical, payloadHash, signature;
  void clear();
};

// Strict, bounded JSON subset: valid Unicode scalars and JS-safe integral
// numbers only. Fractional/unsafe numbers fail closed rather than mis-sign.
bool validJson(const std::string& input);
bool canonicalJson(const std::string& input, std::string& output);
std::string base64url(const uint8_t* bytes, size_t length);
bool sign(const std::string& method, const std::string& path,
          const std::string& input, const Credentials& credentials, SignedRequest& output);
bool verify(const std::string& method, const std::string& path,
            const std::string& input, const Credentials& credentials, const std::string& signature);
bool validId(const std::string& value);
bool validKeyId(const std::string& value);
bool validCode(const std::string& value);
}
